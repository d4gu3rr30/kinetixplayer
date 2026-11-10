import Foundation
import CryptoKit

/// Yandex Music client: search and signed MP3 streams.
enum YandexClient {
    private static let api = "https://api.music.yandex.net"
    private static let userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
    private static let lock = NSLock()
    private static var streams: [String: Stream] = [:]
    private static let idPattern = try? NSRegularExpression(pattern: #"^\d{1,20}$"#)

    struct Stream {
        let url: String
        let type: String
        let expires: Date
    }

    static func search(token: String, query rawQuery: String, limit: Int) throws -> [[String: Any]] {
        let query = rawQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.isEmpty { throw KinetixError("Введите запрос") }
        let target = api + "/search?text=" + encode(query) + "&type=track&page=0&nocorrect=false"
        let data = try request(target, token: token)
        let result = data["result"] as? [String: Any]
        let tracksNode = result?["tracks"] as? [String: Any]
        let results = tracksNode?["results"] as? [Any] ?? []
        var tracks: [[String: Any]] = []
        for item in results {
            if tracks.count >= limit { break }
            guard let track = track(of: item as? [String: Any]) else { continue }
            tracks.append(track)
        }
        return tracks
    }

    static func resolve(token: String, track rawId: String) throws -> Stream {
        let id = rawId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isTrackId(id) else { throw KinetixError("Некорректный идентификатор трека Яндекс Музыки") }
        lock.lock()
        let cached = streams[id]
        lock.unlock()
        if let cached = cached, cached.expires > Date() { return cached }
        if token.isEmpty { throw KinetixError("Добавьте токен Яндекс Музыки в настройках") }

        let info = try request(api + "/tracks/" + id + "/download-info", token: token)
        let raw = info["result"] as? [Any] ?? []
        var options = raw.compactMap { $0 as? [String: Any] }.filter {
            !($0["downloadInfoUrl"] as? String ?? "").isEmpty
        }
        options.sort { left, right in
            let leftMp3 = (left["codec"] as? String ?? "").lowercased() == "mp3"
            let rightMp3 = (right["codec"] as? String ?? "").lowercased() == "mp3"
            if leftMp3 != rightMp3 { return leftMp3 }
            return int(right["bitrateInKbps"]) > int(left["bitrateInKbps"])
        }
        guard let option = options.first else { throw KinetixError("Трек недоступен в Яндекс Музыке") }

        let xml = try fetchText(option["downloadInfoUrl"] as? String ?? "")
        let host = tag(xml, "host")
        let path = tag(xml, "path")
        let timestamp = tag(xml, "ts")
        let salt = tag(xml, "s")
        if host.isEmpty || path.isEmpty || timestamp.isEmpty || salt.isEmpty {
            throw KinetixError("Не удалось подписать поток Яндекс Музыки")
        }
        let signature = md5(salt + path)
        let type = (option["codec"] as? String ?? "").lowercased() == "aac" ? "audio/mp4" : "audio/mpeg"
        let stream = Stream(
            url: "https://\(host)/get-mp3/\(signature)/\(timestamp)\(path)",
            type: type,
            expires: Date().addingTimeInterval(25 * 60)
        )
        lock.lock()
        if streams.count > 100 { streams.removeAll() }
        streams[id] = stream
        lock.unlock()
        return stream
    }

    static func forget(_ trackId: String) {
        let id = trackId.trimmingCharacters(in: .whitespacesAndNewlines)
        lock.lock()
        streams.removeValue(forKey: id)
        lock.unlock()
    }

    private static func track(of item: [String: Any]?) -> [String: Any]? {
        guard let item = item else { return nil }
        if let available = item["available"], !bool(available, fallback: true) { return nil }
        let id = string(item["id"])
        let title = (item["title"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !isTrackId(id) || title.isEmpty { return nil }

        var artists: [String] = []
        if let list = item["artists"] as? [Any] {
            for element in list {
                guard let performer = element as? [String: Any] else { continue }
                let name = (performer["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty { artists.append(name) }
            }
        }

        var cover = item["coverUri"] as? String ?? ""
        if cover.isEmpty, let albums = item["albums"] as? [Any], let album = albums.first as? [String: Any] {
            cover = album["coverUri"] as? String ?? ""
        }

        var track: [String: Any] = [
            "id": "yandex:" + id,
            "title": title,
            "artist": artists.isEmpty ? "Яндекс Музыка" : artists.joined(separator: ", "),
            "url": "https://music.yandex.ru/track/" + id,
            "streamUrl": "/api/yandex-stream?id=" + id,
            "source": "yandex"
        ]
        if !cover.isEmpty {
            track["artwork"] = "https://" + cover.replacingOccurrences(of: "%%", with: "400x400")
        }
        let durationMs = int(item["durationMs"])
        if durationMs > 0 { track["duration"] = NSNumber(value: Double(durationMs) / 1000.0) }
        return track
    }

    private static func request(_ url: String, token: String) throws -> [String: Any] {
        guard let target = URL(string: url) else { throw KinetixError("Некорректный адрес Яндекс Музыки") }
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty { request.setValue("OAuth " + token, forHTTPHeaderField: "Authorization") }
        let (data, response) = try SyncHTTP.data(for: request, timeout: 20)
        guard let http = response as? HTTPURLResponse else { throw KinetixError("Яндекс Музыка не ответила") }
        if http.statusCode == 401 || http.statusCode == 403 {
            throw KinetixError("Яндекс Музыка не приняла токен — проверьте его в настройках")
        }
        guard (200...299).contains(http.statusCode) else {
            throw KinetixError("Яндекс Музыка недоступна (\(http.statusCode))")
        }
        guard let value = try? JSONSerialization.jsonObject(with: data), let object = value as? [String: Any] else {
            throw KinetixError("Яндекс Музыка вернула непонятный ответ")
        }
        return object
    }

    private static func fetchText(_ url: String) throws -> String {
        guard let target = URL(string: url) else { throw KinetixError("Не удалось получить ссылку на поток Яндекс Музыки") }
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        let (data, response) = try SyncHTTP.data(for: request, timeout: 20)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw KinetixError("Не удалось получить ссылку на поток Яндекс Музыки")
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func tag(_ xml: String, _ name: String) -> String {
        let pattern = "<\(name)>(.*?)</\(name)>"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]),
              let match = regex.firstMatch(in: xml, range: NSRange(xml.startIndex..., in: xml)),
              let range = Range(match.range(at: 1), in: xml) else { return "" }
        return String(xml[range])
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }

    private static func md5(_ value: String) -> String {
        Insecure.MD5.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func isTrackId(_ value: String) -> Bool {
        guard let regex = idPattern else { return false }
        return regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    private static func string(_ value: Any?) -> String {
        if let text = value as? String { return text }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }

    private static func int(_ value: Any?) -> Int {
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) ?? 0 }
        return 0
    }

    private static func bool(_ value: Any, fallback: Bool) -> Bool {
        if let number = value as? NSNumber { return number.boolValue }
        if let text = value as? String { return text != "false" && text != "0" }
        return fallback
    }

    private static func encode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
