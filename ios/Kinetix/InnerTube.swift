import Foundation

struct KinetixError: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

enum KinetixText {
    static func shorten(_ value: String, _ limit: Int) -> String {
        let clean = value
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.count > limit ? String(clean.prefix(limit)) + "…" : clean
    }
}

/// Runs URLSession synchronously. The loopback server already handles requests on its own
/// threads, so blocking there keeps the route code straightforward.
enum SyncHTTP {
    static func data(for request: URLRequest, timeout: TimeInterval = 40) throws -> (Data, URLResponse) {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<(Data, URLResponse), Error>?
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                result = .failure(error)
            } else if let data = data, let response = response {
                result = .success((data, response))
            } else {
                result = .failure(KinetixError("Сеть недоступна"))
            }
            semaphore.signal()
        }
        task.resume()
        if semaphore.wait(timeout: .now() + timeout) == .timedOut {
            task.cancel()
            throw KinetixError("Сеть не отвечает")
        }
        switch result {
        case .success(let value):
            return value
        case .failure(let error):
            throw error
        case nil:
            throw KinetixError("Сеть недоступна")
        }
    }
}

/// Minimal YouTube InnerTube client for the VR client, which still hands out
/// direct audio URLs without a cipher or a PoToken.
final class InnerTube {
    static let shared = InnerTube()

    struct Stream {
        let url: String
        let mime: String
        let expires: Date
    }

    private struct CacheEntry {
        let tracks: [[String: Any]]
        let expires: Date
    }

    private let userAgent = "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip"
    private let clientName = "ANDROID_VR"
    private let clientVersion = "1.62.27"

    private let lock = NSLock()
    private var searchCache: [String: CacheEntry] = [:]
    private var relatedCache: [String: CacheEntry] = [:]
    private var streams: [String: Stream] = [:]
    private var cookieHeader = ""

    private static let dashedTitle = regex(#"^(.{1,60}?)\s+[-–—]\s+(.{1,140})$"#)
    private static let titleNoise = regex(#"\s*[\[(][^\])]*(?:official\s*(?:music\s*)?(?:video|audio|visualizer|lyric\s*video)|lyrics?|клип|премьера|premiere|m/?v|audio|visualizer)[^\])]*[\])]\s*$"#, options: [.caseInsensitive])
    private static let catalogJunk = regex(#"интервью|подкаст|podcast|interview|реакци|reaction|обзор|review|full album|альбом|плейлист|сборник|playlist|compilation"#, options: [.caseInsensitive])

    private static func regex(_ pattern: String, options: NSRegularExpression.Options = []) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: options)
    }

    private init() {}

    /// Cookies saved from a signed-in browser; empty means anonymous requests.
    func setCookies(_ header: String) {
        let value = header.trimmingCharacters(in: .whitespacesAndNewlines)
        lock.lock()
        cookieHeader = value
        searchCache.removeAll()
        relatedCache.removeAll()
        streams.removeAll()
        lock.unlock()
    }

    func search(_ query: String, limit: Int, artistMode: Bool) throws -> [[String: Any]] {
        let key = (artistMode ? "a|" : "t|") + "\(limit)|" + query.lowercased()
        if let cached = cachedSearch(key) { return cached }
        var payload = basePayload()
        payload["query"] = query
        let response = try post("search", payload)
        var videos: [[String: Any]] = []
        var seen = Set<String>()
        collectVideos(response, into: &videos, seen: &seen)
        let tracks = toTracks(videos, limit: limit, artistMode: artistMode)
        if tracks.isEmpty { throw KinetixError("YouTube не вернул результаты поиска") }
        storeSearch(key, tracks)
        return tracks
    }

    func related(_ videoId: String, limit: Int) throws -> [[String: Any]] {
        let key = "\(limit)|" + videoId
        if let cached = cachedRelated(key) { return cached }
        var payload = basePayload()
        payload["videoId"] = videoId
        let response = try post("next", payload)
        var videos: [[String: Any]] = []
        var seen = Set<String>()
        collectVideos(response, into: &videos, seen: &seen)
        let tracks = toTracks(videos, limit: limit, artistMode: false)
        storeRelated(key, tracks)
        return tracks
    }

    func forget(_ videoId: String) {
        lock.lock()
        streams.removeValue(forKey: videoId)
        lock.unlock()
    }

    func resolve(_ videoId: String) throws -> Stream {
        lock.lock()
        let cached = streams[videoId]
        lock.unlock()
        let now = Date()
        if let cached = cached, cached.expires > now { return cached }

        let hasCookies: Bool = {
            lock.lock()
            defer { lock.unlock() }
            return !cookieHeader.isEmpty
        }()

        var response: [String: Any]
        var state: String
        do {
            response = try player(videoId, authenticated: true)
            state = playabilityState(response)
        } catch {
            guard hasCookies else { throw error }
            response = try player(videoId, authenticated: false)
            state = playabilityState(response)
        }
        // A stale signed-in cookie makes YouTube answer LOGIN_REQUIRED for every
        // track. The anonymous request is the fallback that keeps the wave alive.
        if state != "OK", hasCookies, let fallback = try? player(videoId, authenticated: false) {
            let fallbackState = playabilityState(fallback)
            if fallbackState == "OK" {
                response = fallback
                state = fallbackState
            }
        }
        if state != "OK" {
            let status = response["playabilityStatus"] as? [String: Any]
            let reason = (status?["reason"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if state == "LOGIN_REQUIRED" {
                throw KinetixError("YouTube просит войти в аккаунт для этого трека — включи другой, он заиграет")
            }
            throw KinetixError(reason.isEmpty ? "YouTube не отдал этот трек" : reason)
        }

        guard let streaming = response["streamingData"] as? [String: Any] else {
            throw KinetixError("YouTube не отдал аудиопоток")
        }
        guard let formats = (streaming["adaptiveFormats"] as? [[String: Any]]) ?? (streaming["formats"] as? [[String: Any]]) else {
            throw KinetixError("YouTube не отдал аудиопоток")
        }

        var best: [String: Any]?
        var bestRank = -1
        for format in formats {
            let mime = format["mimeType"] as? String ?? ""
            if !mime.hasPrefix("audio/") { continue }
            let url = format["url"] as? String ?? ""
            if url.isEmpty { continue }
            let rank = audioRank(intValue(format["itag"]), mime)
            if rank > bestRank {
                bestRank = rank
                best = format
            }
        }
        guard let chosen = best else { throw KinetixError("YouTube не отдал аудиодорожку") }

        var mime = chosen["mimeType"] as? String ?? "audio/mp4"
        if let separator = mime.firstIndex(of: ";") {
            mime = String(mime[..<separator]).trimmingCharacters(in: .whitespaces)
        }
        let expiresIn = intValue(streaming["expiresInSeconds"])
        let ttl = max(120, min(expiresIn > 0 ? expiresIn : 3 * 60 * 60, 3 * 60 * 60))
        let stream = Stream(url: chosen["url"] as? String ?? "", mime: mime, expires: now.addingTimeInterval(TimeInterval(ttl)))

        lock.lock()
        if streams.count > 120 { streams.removeAll() }
        streams[videoId] = stream
        lock.unlock()
        return stream
    }

    private func intValue(_ value: Any?) -> Int {
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) ?? 0 }
        return 0
    }

    private func audioRank(_ itag: Int, _ mime: String) -> Int {
        switch itag {
        case 140: return 100
        case 251: return 90
        case 139: return 70
        case 249: return 60
        case 141: return 50
        default:
            if mime.contains("mp4a") { return 40 }
            if mime.contains("opus") { return 30 }
            return 10
        }
    }

    private func basePayload() -> [String: Any] {
        var client: [String: Any] = [:]
        client["clientName"] = clientName
        client["clientVersion"] = clientVersion
        client["androidSdkVersion"] = 32
        client["deviceMake"] = "Oculus"
        client["deviceModel"] = "Quest 3"
        client["osName"] = "Android"
        client["osVersion"] = "12"
        client["hl"] = "ru"
        client["gl"] = "US"
        return ["context": ["client": client]]
    }

    private func player(_ videoId: String, authenticated: Bool) throws -> [String: Any] {
        var payload = basePayload()
        payload["videoId"] = videoId
        payload["contentCheckOk"] = true
        payload["racyCheckOk"] = true
        return try post("player", payload, authenticated: authenticated)
    }

    private func playabilityState(_ response: [String: Any]) -> String {
        let status = response["playabilityStatus"] as? [String: Any]
        return status?["status"] as? String ?? ""
    }

    private func post(_ endpoint: String, _ payload: [String: Any], authenticated: Bool = true) throws -> [String: Any] {
        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/\(endpoint)?prettyPrint=false") else {
            throw KinetixError("Некорректный адрес YouTube")
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpMethod = "POST"
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("ru-RU,ru;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        request.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
        request.setValue("28", forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(clientVersion, forHTTPHeaderField: "X-YouTube-Client-Version")
        lock.lock()
        let cookies = authenticated ? cookieHeader : ""
        lock.unlock()
        if !cookies.isEmpty {
            let safe = cookies.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
            request.setValue(safe, forHTTPHeaderField: "Cookie")
            request.setValue("0", forHTTPHeaderField: "X-Goog-AuthUser")
            request.setValue("https://www.youtube.com", forHTTPHeaderField: "X-Origin")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try SyncHTTP.data(for: request, timeout: 35)
        guard let http = response as? HTTPURLResponse else { throw KinetixError("YouTube не ответил") }
        guard (200...299).contains(http.statusCode) else {
            let detail = KinetixText.shorten(String(data: data, encoding: .utf8) ?? "", 120)
            throw KinetixError("YouTube ответил \(http.statusCode)" + (detail.isEmpty ? "" : ": \(detail)"))
        }
        guard let value = try? JSONSerialization.jsonObject(with: data), let object = value as? [String: Any] else {
            throw KinetixError("YouTube вернул непонятный ответ")
        }
        return object
    }

    private func collectVideos(_ node: Any, into out: inout [[String: Any]], seen: inout Set<String>) {
        if let object = node as? [String: Any] {
            if let video = (object["videoRenderer"] as? [String: Any]) ?? (object["compactVideoRenderer"] as? [String: Any]) {
                if let id = video["videoId"] as? String, isVideoId(id), seen.insert(id).inserted {
                    out.append(video)
                }
                return
            }
            for value in object.values {
                collectVideos(value, into: &out, seen: &seen)
            }
        } else if let array = node as? [Any] {
            for value in array {
                collectVideos(value, into: &out, seen: &seen)
            }
        }
    }

    private func isVideoId(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil
    }

    private func toTracks(_ videos: [[String: Any]], limit: Int, artistMode: Bool) -> [[String: Any]] {
        var tracks: [[String: Any]] = []
        var fingerprints = Set<String>()
        for video in videos {
            if tracks.count >= limit { break }
            guard let track = track(of: video, artistMode: artistMode) else { continue }
            let fingerprint = normalize(track["artist"] as? String ?? "") + "|" + normalize(track["title"] as? String ?? "")
            if !fingerprints.insert(fingerprint).inserted { continue }
            tracks.append(track)
        }
        return tracks
    }

    private func track(of video: [String: Any], artistMode: Bool) -> [String: Any]? {
        guard let videoId = video["videoId"] as? String, isVideoId(videoId) else { return nil }
        let rawTitle = text(video, "title")
        if rawTitle.isEmpty { return nil }
        var channel = text(video, "longBylineText")
        if channel.isEmpty { channel = text(video, "shortBylineText") }
        if channel.isEmpty { channel = text(video, "ownerText") }
        let duration = parseDuration(text(video, "lengthText"))
        if duration <= 0 { return nil }
        if duration < 20 || duration > (artistMode ? 720 : 3600) { return nil }

        let cleanedTitle = tidyTitle(rawTitle)
        var artist = cleanChannel(channel)
        var title = cleanedTitle
        if !isTopic(channel), let regex = Self.dashedTitle,
           let match = regex.firstMatch(in: cleanedTitle, range: NSRange(cleanedTitle.startIndex..., in: cleanedTitle)),
           let first = Range(match.range(at: 1), in: cleanedTitle),
           let second = Range(match.range(at: 2), in: cleanedTitle) {
            artist = String(cleanedTitle[first]).trimmingCharacters(in: .whitespaces)
            title = String(cleanedTitle[second]).trimmingCharacters(in: .whitespaces)
        }
        if title.isEmpty { return nil }
        if artistMode, let junk = Self.catalogJunk,
           junk.firstMatch(in: title, range: NSRange(title.startIndex..., in: title)) != nil {
            return nil
        }
        if artist.isEmpty { artist = "YouTube" }

        return [
            "id": "yt:" + videoId,
            "title": title,
            "artist": artist,
            "artwork": "https://i.ytimg.com/vi/\(videoId)/hqdefault.jpg",
            "url": "https://www.youtube.com/watch?v=\(videoId)",
            "streamUrl": "/api/yt-stream?v=\(videoId)",
            "duration": duration,
            "source": "youtube"
        ]
    }

    private func text(_ object: [String: Any], _ key: String) -> String {
        if let node = object[key] as? [String: Any] {
            if let simple = node["simpleText"] as? String, !simple.isEmpty { return simple }
            if let runs = node["runs"] as? [[String: Any]] {
                let joined = runs.compactMap { $0["text"] as? String }.joined()
                if !joined.isEmpty { return joined }
            }
        }
        return object[key] as? String ?? ""
    }

    private func parseDuration(_ value: String) -> Int {
        let parts = value.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ":")
        let numbers = parts.compactMap { Int($0) }
        guard numbers.count == parts.count, numbers.count == 2 || numbers.count == 3 else { return 0 }
        if numbers.count == 3 { return numbers[0] * 3600 + numbers[1] * 60 + numbers[2] }
        return numbers[0] * 60 + numbers[1]
    }

    private func isTopic(_ channel: String) -> Bool {
        channel.lowercased().hasSuffix("- topic")
    }

    private func cleanChannel(_ channel: String) -> String {
        var value = channel.trimmingCharacters(in: .whitespacesAndNewlines)
        value = value.replacingOccurrences(of: #"(?i)\s*-\s*topic\s*$"#, with: "", options: .regularExpression)
        value = value.replacingOccurrences(of: #"(?i)\s*vevo\s*$"#, with: "", options: .regularExpression)
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func tidyTitle(_ title: String) -> String {
        var value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let regex = Self.titleNoise else { return value }
        for _ in 0..<3 {
            guard let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
                  let range = Range(match.range, in: value) else { break }
            value = (String(value[value.startIndex..<range.lowerBound]) + String(value[range.upperBound...]))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return value
    }

    private func normalize(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: #"[^\p{L}\p{N}]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func cachedSearch(_ key: String) -> [[String: Any]]? {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = searchCache[key], entry.expires > Date() else { return nil }
        return entry.tracks
    }

    private func storeSearch(_ key: String, _ tracks: [[String: Any]]) {
        lock.lock()
        if searchCache.count > 80 { searchCache.removeAll() }
        searchCache[key] = CacheEntry(tracks: tracks, expires: Date().addingTimeInterval(5 * 60))
        lock.unlock()
    }

    private func cachedRelated(_ key: String) -> [[String: Any]]? {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = relatedCache[key], entry.expires > Date() else { return nil }
        return entry.tracks
    }

    private func storeRelated(_ key: String, _ tracks: [[String: Any]]) {
        lock.lock()
        if relatedCache.count > 80 { relatedCache.removeAll() }
        relatedCache[key] = CacheEntry(tracks: tracks, expires: Date().addingTimeInterval(5 * 60))
        lock.unlock()
    }

    func deezer(_ path: String) throws -> [String: Any] {
        let target = path.hasPrefix("/") ? path : "/" + path
        if target.contains("://") || target.contains(" ") { throw KinetixError("Некорректный запрос") }
        guard let url = URL(string: "https://api.deezer.com" + target) else { throw KinetixError("Некорректный запрос") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("Kinetix/1.0 (iOS)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try SyncHTTP.data(for: request, timeout: 25)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw KinetixError("Deezer не ответил")
        }
        guard let value = try? JSONSerialization.jsonObject(with: data), let object = value as? [String: Any] else {
            throw KinetixError("Deezer вернул непонятный ответ")
        }
        if let error = object["error"] as? [String: Any] {
            throw KinetixError(error["message"] as? String ?? "Deezer не ответил")
        }
        return object
    }
}
