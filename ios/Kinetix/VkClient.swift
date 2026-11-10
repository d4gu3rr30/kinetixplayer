import Foundation

/// Minimal VK audio client: search, stream lookup and signed URL refresh.
enum VkClient {
    private static let api = "https://api.vk.com/method"
    private static let userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    private static let lock = NSLock()
    private static var streams: [String: Stream] = [:]

    private static let audioHost = try? NSRegularExpression(
        pattern: #"(^|\.)(userapi\.com|vkuseraudio\.net|vk-cdn\.net|mycdn\.me|vk\.com)$"#,
        options: [.caseInsensitive]
    )
    private static let trackId = try? NSRegularExpression(pattern: #"^(?:vk:)?(-?\d+)_(\d+)$"#)
    private static let expiresParam = try? NSRegularExpression(pattern: #"[?&]expires=(\d+)"#)

    struct Stream {
        let url: String
        let expires: Date
    }

    static func search(token: String, query rawQuery: String, limit: Int, artist: Bool, offset: Int) throws -> [[String: Any]] {
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty { throw KinetixError("Введите запрос") }
        var target = api + "/audio.search?access_token=" + encode(token)
        target += "&v=5.95&q=" + encode(query)
        target += "&count=\(max(1, min(limit, 50)))"
        if offset > 0 { target += "&offset=\(offset)" }
        if artist { target += "&performer_only=1" }
        let data = try call(target)
        let items: [Any]
        if let response = data["response"] as? [String: Any] {
            items = response["items"] as? [Any] ?? []
        } else {
            items = data["response"] as? [Any] ?? []
        }
        var tracks: [[String: Any]] = []
        for item in items {
            guard let track = track(of: item as? [String: Any]) else { continue }
            tracks.append(track)
        }
        return tracks
    }

    static func resolve(token: String, rawId: String) throws -> Stream {
        let id = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = firstMatch(trackId, id) else {
            throw KinetixError("Некорректный идентификатор трека ВКонтакте")
        }
        let audioId = "\(group(match, id, 1))_\(group(match, id, 2))"
        lock.lock()
        let cached = streams[audioId]
        lock.unlock()
        if let cached = cached, cached.expires > Date() { return cached }

        let target = api + "/audio.getById?access_token=" + encode(token) + "&v=5.95&audios=" + encode(audioId)
        let data = try call(target)
        let items: [Any]
        if let response = data["response"] as? [String: Any] {
            items = response["items"] as? [Any] ?? []
        } else {
            items = data["response"] as? [Any] ?? []
        }
        let item = items.first as? [String: Any]
        let url = item?["url"] as? String ?? ""
        if url.isEmpty {
            throw KinetixError("ВКонтакте не отдал аудиопоток — трек удалён или скрыт")
        }
        if !hostAllowed(url) {
            throw KinetixError("ВКонтакте вернул небезопасную ссылку на поток")
        }
        var expires = Date().addingTimeInterval(30 * 60)
        if let match = firstMatch(expiresParam, url), let value = Int64(group(match, url, 1)), value > 0 {
            let signed = Date(timeIntervalSince1970: TimeInterval(value) - 60)
            if signed < expires { expires = signed }
        }
        let stream = Stream(url: url, expires: expires)
        lock.lock()
        if streams.count > 80 { streams.removeAll() }
        streams[audioId] = stream
        lock.unlock()
        return stream
    }

    static func forget(_ rawId: String) {
        let id = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = firstMatch(trackId, id) else { return }
        lock.lock()
        streams.removeValue(forKey: "\(group(match, id, 1))_\(group(match, id, 2))")
        lock.unlock()
    }

    private static func track(of item: [String: Any]?) -> [String: Any]? {
        guard let item = item else { return nil }
        let url = item["url"] as? String ?? ""
        let id = int64(item["id"])
        let owner = int64(item["owner_id"])
        let title = (item["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if url.isEmpty || id == 0 || owner == 0 || title.isEmpty { return nil }
        if !hostAllowed(url) { return nil }
        let artist = (item["artist"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var artwork = ""
        if let album = item["album"] as? [String: Any], let thumb = album["thumb"] as? [String: Any] {
            let large = thumb["photo_600"] as? String ?? ""
            artwork = large.isEmpty ? (thumb["photo_270"] as? String ?? "") : large
        }
        var track: [String: Any] = [
            "id": "vk:\(owner)_\(id)",
            "title": title,
            "artist": artist.isEmpty ? "ВКонтакте" : artist,
            "url": "https://vk.com/audio\(owner)_\(id)",
            "streamUrl": "/api/vk-stream?id=" + encode("\(owner)_\(id)"),
            "source": "vk"
        ]
        if !artwork.isEmpty { track["artwork"] = artwork }
        let duration = int64(item["duration"])
        if duration > 0 { track["duration"] = NSNumber(value: duration) }
        return track
    }

    private static func call(_ url: String) throws -> [String: Any] {
        guard let target = URL(string: url) else { throw KinetixError("Некорректный адрес ВКонтакте") }
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try SyncHTTP.data(for: request, timeout: 20)
        guard let http = response as? HTTPURLResponse else { throw KinetixError("ВКонтакте не ответил") }
        guard (200...299).contains(http.statusCode) else {
            throw KinetixError("ВКонтакте ответил \(http.statusCode)")
        }
        guard let value = try? JSONSerialization.jsonObject(with: data), let object = value as? [String: Any] else {
            throw KinetixError("ВКонтакте вернул непонятный ответ")
        }
        if let error = object["error"] as? [String: Any] {
            let message = (error["error_msg"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if message.range(
                of: #"(?i).*(access_token.*(expired|invalid)|user authorization failed|authorization failed).*"#,
                options: .regularExpression
            ) != nil {
                throw KinetixError("Токен ВКонтакте не принят — обновите его в настройках")
            }
            throw KinetixError(message.isEmpty ? "ВКонтакте отклонил запрос" : message)
        }
        return object
    }

    private static func hostAllowed(_ raw: String) -> Bool {
        guard let url = URL(string: raw), url.scheme?.lowercased() == "https", let host = url.host else { return false }
        let range = NSRange(host.startIndex..., in: host)
        return audioHost?.firstMatch(in: host, range: range) != nil
    }

    private static func int64(_ value: Any?) -> Int64 {
        if let number = value as? NSNumber { return number.int64Value }
        if let string = value as? String { return Int64(string) ?? 0 }
        return 0
    }

    private static func encode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static func firstMatch(_ regex: NSRegularExpression?, _ value: String) -> NSTextCheckingResult? {
        guard let regex = regex else { return nil }
        return regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value))
    }

    private static func group(_ match: NSTextCheckingResult, _ value: String, _ index: Int) -> String {
        guard let range = Range(match.range(at: index), in: value) else { return "" }
        return String(value[range])
    }
}
