import Foundation
import CFNetwork
import os.log

let kinetixLog = Logger(subsystem: "app.kinetix.player", category: "net")

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

/// A user-supplied proxy used ONLY for YouTube traffic; Yandex and VK always
/// go out directly so a foreign VPN exit cannot break them.
struct ProxyConfig {
    let host: String
    let port: Int
    let socks: Bool
    let username: String
    let password: String

    static func parse(_ raw: String) -> ProxyConfig? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "http://" + text }
        guard let url = URL(string: text), let host = url.host, !host.isEmpty else { return nil }
        let scheme = (url.scheme ?? "http").lowercased()
        let socks = scheme.hasPrefix("socks")
        guard scheme == "http" || scheme == "https" || socks else { return nil }
        let port = url.port ?? (socks ? 1080 : 8080)
        guard port > 0 && port <= 65535 else { return nil }
        return ProxyConfig(host: host, port: port, socks: socks, username: url.user ?? "", password: url.password ?? "")
    }

    // String keys: iOS marks the SOCKS/HTTPS CFNetwork constants unavailable,
    // but connectionProxyDictionary reads these same keys on every platform.
    var dictionary: [AnyHashable: Any] {
        var dict: [AnyHashable: Any] = [:]
        if socks {
            dict["SOCKSEnable"] = true
            dict["SOCKSProxy"] = host
            dict["SOCKSPort"] = port
        } else {
            dict["HTTPEnable"] = true
            dict["HTTPProxy"] = host
            dict["HTTPPort"] = port
            dict["HTTPSEnable"] = true
            dict["HTTPSProxy"] = host
            dict["HTTPSPort"] = port
        }
        if !username.isEmpty {
            dict[kCFProxyUsernameKey] = username
            dict[kCFProxyPasswordKey] = password
        }
        return dict
    }
}

/// A dead VPN endpoint makes every hostname resolve stall for tens of seconds.
/// Once two stream lookups in a row time out, fail fast for a few seconds so
/// the player cannot get stuck in a retry storm. Scopes are separate: a blocked
/// YouTube must not silence a working Yandex, and search is never gated.
enum NetworkGate {
    private static let lock = NSLock()
    private static var failures: [String: Int] = [:]
    private static var lastFailure: [String: Date] = [:]
    private static var blockedUntil: [String: Date] = [:]

    static func check(_ scope: String) throws {
        lock.lock()
        let until = blockedUntil[scope] ?? .distantPast
        lock.unlock()
        if Date() < until { throw KinetixError("Сеть не отвечает. Проверьте VPN и попробуйте снова") }
    }

    static func isNetwork(_ error: Error) -> Bool {
        if (error as NSError).domain == NSURLErrorDomain { return true }
        return (error as? KinetixError)?.message.hasPrefix("Сеть") == true
    }

    static func success(_ scope: String) {
        lock.lock()
        failures[scope] = 0
        blockedUntil[scope] = .distantPast
        lock.unlock()
    }

    static func failure(_ scope: String) {
        lock.lock()
        defer { lock.unlock() }
        let now = Date()
        if now.timeIntervalSince(lastFailure[scope] ?? .distantPast) > 20 { failures[scope] = 0 }
        let count = (failures[scope] ?? 0) + 1
        failures[scope] = count
        lastFailure[scope] = now
        blockedUntil[scope] = now.addingTimeInterval(count >= 2 ? 20 : 10)
        if count >= 2 { failures[scope] = 0 }
    }
}

/// Runs URLSession synchronously. The loopback server already handles requests on its own
/// threads, so blocking there keeps the route code straightforward.
enum SyncHTTP {
    static func data(for request: URLRequest, timeout: TimeInterval = 20, gate: String? = nil, session: URLSession = .shared) throws -> (Data, URLResponse) {
        if let gate { try NetworkGate.check(gate) }
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<(Data, URLResponse), Error>?
        let task = session.dataTask(with: request) { data, response, error in
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
            if let gate { NetworkGate.failure(gate) }
            throw KinetixError("Сеть не отвечает")
        }
        switch result {
        case .success(let value):
            if let gate { NetworkGate.success(gate) }
            return value
        case .failure(let error):
            if let gate, (error as NSError).domain == NSURLErrorDomain { NetworkGate.failure(gate) }
            throw error
        case nil:
            if let gate { NetworkGate.failure(gate) }
            throw KinetixError("Сеть недоступна")
        }
    }
}

/// Minimal YouTube InnerTube client. googlevideo ties a stream URL to the
/// client that asked for it, so the CDN download must carry the same
/// User-Agent; individual clients also get rejected server-side over time,
/// so resolve() rotates through a list of profiles.
final class InnerTube {
    static let shared = InnerTube()

    private struct ClientProfile {
        let tag: String
        let name: String
        let version: String
        let userAgent: String
        let headerName: String
        let extra: [String: Any]
    }

    private static let profiles: [ClientProfile] = [
        ClientProfile(tag: "vr", name: "ANDROID_VR", version: "1.62.27",
                      userAgent: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220605.009.A1) gzip",
                      headerName: "28",
                      extra: ["androidSdkVersion": 32, "deviceMake": "Oculus", "deviceModel": "Quest 3", "osName": "Android", "osVersion": "12"]),
        ClientProfile(tag: "ios", name: "IOS", version: "20.10.4",
                      userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)",
                      headerName: "5",
                      extra: ["deviceMake": "Apple", "deviceModel": "iPhone16,2", "osName": "iPhone", "osVersion": "17.5.1.21F90"]),
        ClientProfile(tag: "android", name: "ANDROID", version: "20.10.38",
                      userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 12; en_US; Pixel 6 Build/SQ3A.220605.009.A1) gzip",
                      headerName: "3",
                      extra: ["androidSdkVersion": 32, "deviceMake": "Google", "deviceModel": "Pixel 6", "osName": "Android", "osVersion": "12"]),
        ClientProfile(tag: "tv", name: "TVHTML5", version: "7.20250312.16.00",
                      userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version",
                      headerName: "7",
                      extra: [:]),
    ]

    struct Stream {
        let url: String
        let mime: String
        let expires: Date
        let userAgent: String
        let tag: String
    }

    private struct CacheEntry {
        let tracks: [[String: Any]]
        let expires: Date
    }

    private let lock = NSLock()
    private var clientIndex = 0
    private var searchCache: [String: CacheEntry] = [:]
    private var relatedCache: [String: CacheEntry] = [:]
    private var streams: [String: Stream] = [:]
    private var cookieHeader = ""
    private var proxy: ProxyConfig?
    private var session: URLSession = .shared

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

    /// Empty string disables the proxy. Stream URLs are tied to the exit IP,
    /// so cached ones are dropped whenever the route changes.
    func setProxy(_ raw: String) {
        let config = ProxyConfig.parse(raw)
        let configuration = URLSessionConfiguration.ephemeral
        if let config { configuration.connectionProxyDictionary = config.dictionary }
        let fresh = URLSession(configuration: configuration)
        lock.lock()
        let old = session
        proxy = config
        session = fresh
        streams.removeAll()
        lock.unlock()
        if old !== URLSession.shared { old.finishTasksAndInvalidate() }
        kinetixLog.info("yt proxy \(config == nil ? "off" : "on", privacy: .public)")
    }

    var proxyConfig: ProxyConfig? {
        lock.lock()
        defer { lock.unlock() }
        return proxy
    }

    var apiSession: URLSession {
        lock.lock()
        defer { lock.unlock() }
        return session
    }

    func search(_ query: String, limit: Int, artistMode: Bool) throws -> [[String: Any]] {
        let key = (artistMode ? "a|" : "t|") + "\(limit)|" + query.lowercased()
        if let cached = cachedSearch(key) { return cached }
        let response = try lookup("search") { profile in
            var payload = self.basePayload(profile)
            payload["query"] = query
            return payload
        }
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
        let response = try lookup("next") { profile in
            var payload = self.basePayload(profile)
            payload["videoId"] = videoId
            return payload
        }
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

    func rotate() {
        lock.lock()
        clientIndex = (clientIndex + 1) % Self.profiles.count
        lock.unlock()
    }

    private func lookup(_ endpoint: String, _ makePayload: (ClientProfile) -> [String: Any]) throws -> [String: Any] {
        lock.lock()
        let start = clientIndex
        lock.unlock()
        var lastError: Error = KinetixError("YouTube не ответил")
        for offset in 0..<2 {
            let profile = Self.profiles[(start + offset) % Self.profiles.count]
            do {
                return try post(endpoint, makePayload(profile), profile: profile)
            } catch {
                kinetixLog.error("yt \(endpoint, privacy: .public) \(profile.tag, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
                lastError = error
            }
        }
        throw lastError
    }

    func resolve(_ videoId: String) throws -> Stream {
        try NetworkGate.check("yt")
        lock.lock()
        let cached = streams[videoId]
        let start = clientIndex
        let hasCookies = !cookieHeader.isEmpty
        lock.unlock()
        let now = Date()
        if let cached = cached, cached.expires > now { return cached }

        // The authenticated, anonymous and fallback lookups each used to wait
        // 35 seconds; on a stalled VPN that kept the player frozen for minutes.
        let deadline = now.addingTimeInterval(24)
        func budget() throws -> TimeInterval {
            let left = deadline.timeIntervalSinceNow
            if left < 1 {
                NetworkGate.failure("yt")
                throw KinetixError("Сеть не отвечает. Проверьте VPN и попробуйте снова")
            }
            return min(10, left)
        }

        var lastReason = ""
        for offset in 0..<Self.profiles.count {
            let index = (start + offset) % Self.profiles.count
            let profile = Self.profiles[index]
            var response: [String: Any]?
            var state = ""
            do {
                let auth = try player(videoId, profile: profile, authenticated: hasCookies, timeout: budget())
                response = auth
                state = playabilityState(auth)
                // A stale signed-in cookie makes YouTube answer LOGIN_REQUIRED
                // for every track; the anonymous request keeps the wave alive.
                if state != "OK", hasCookies {
                    let anon = try player(videoId, profile: profile, authenticated: false, timeout: budget())
                    if playabilityState(anon) == "OK" {
                        response = anon
                        state = "OK"
                    }
                }
            } catch {
                kinetixLog.error("yt player \(videoId, privacy: .public) \(profile.tag, privacy: .public) error: \(error.localizedDescription, privacy: .public)")
                lastReason = error.localizedDescription
                continue
            }
            guard let response, state == "OK" else {
                let status = response?["playabilityStatus"] as? [String: Any]
                let reason = (status?["reason"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                kinetixLog.error("yt player \(videoId, privacy: .public) \(profile.tag, privacy: .public) state=\(state, privacy: .public) reason=\(reason, privacy: .public)")
                if state == "LOGIN_REQUIRED" {
                    lastReason = "YouTube просит войти в аккаунт для этого трека — включи другой, он заиграет"
                } else {
                    lastReason = reason.isEmpty ? "YouTube не отдал этот трек" : reason
                }
                continue
            }
            guard let streaming = response["streamingData"] as? [String: Any],
                  let formats = (streaming["adaptiveFormats"] as? [[String: Any]]) ?? (streaming["formats"] as? [[String: Any]]) else {
                kinetixLog.error("yt player \(videoId, privacy: .public) \(profile.tag, privacy: .public) no streamingData")
                lastReason = "YouTube не отдал аудиопоток"
                continue
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
            guard let chosen = best else {
                kinetixLog.error("yt player \(videoId, privacy: .public) \(profile.tag, privacy: .public) no audio itag")
                lastReason = "YouTube не отдал аудиодорожку"
                continue
            }

            var mime = chosen["mimeType"] as? String ?? "audio/mp4"
            if let separator = mime.firstIndex(of: ";") {
                mime = String(mime[..<separator]).trimmingCharacters(in: .whitespaces)
            }
            let expiresIn = intValue(streaming["expiresInSeconds"])
            let ttl = max(120, min(expiresIn > 0 ? expiresIn : 3 * 60 * 60, 3 * 60 * 60))
            let stream = Stream(url: chosen["url"] as? String ?? "", mime: mime, expires: now.addingTimeInterval(TimeInterval(ttl)), userAgent: profile.userAgent, tag: profile.tag)

            lock.lock()
            if streams.count > 120 { streams.removeAll() }
            streams[videoId] = stream
            clientIndex = index
            lock.unlock()
            kinetixLog.info("yt player \(videoId, privacy: .public) \(profile.tag, privacy: .public) OK itag=\(self.intValue(chosen["itag"]))")
            return stream
        }
        throw KinetixError(lastReason.isEmpty ? "YouTube не отдал этот трек" : lastReason)
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

    private func basePayload(_ profile: ClientProfile) -> [String: Any] {
        var client: [String: Any] = profile.extra
        client["clientName"] = profile.name
        client["clientVersion"] = profile.version
        client["hl"] = "ru"
        client["gl"] = "US"
        return ["context": ["client": client]]
    }

    private func player(_ videoId: String, profile: ClientProfile, authenticated: Bool, timeout: TimeInterval = 12) throws -> [String: Any] {
        var payload = basePayload(profile)
        payload["videoId"] = videoId
        payload["contentCheckOk"] = true
        payload["racyCheckOk"] = true
        return try post("player", payload, profile: profile, authenticated: authenticated, timeout: timeout, gate: "yt")
    }

    private func playabilityState(_ response: [String: Any]) -> String {
        let status = response["playabilityStatus"] as? [String: Any]
        return status?["status"] as? String ?? ""
    }

    private func post(_ endpoint: String, _ payload: [String: Any], profile: ClientProfile, authenticated: Bool = true, timeout: TimeInterval = 15, gate: String? = nil) throws -> [String: Any] {
        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/\(endpoint)?prettyPrint=false") else {
            throw KinetixError("Некорректный адрес YouTube")
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        request.setValue(profile.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("ru-RU,ru;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        request.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
        request.setValue(profile.headerName, forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(profile.version, forHTTPHeaderField: "X-YouTube-Client-Version")
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
        let (data, response) = try SyncHTTP.data(for: request, timeout: timeout, gate: gate, session: apiSession)
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
