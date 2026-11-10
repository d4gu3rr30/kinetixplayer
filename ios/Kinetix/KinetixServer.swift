import Foundation
import Darwin

/// Loopback HTTP server that serves the bundled web app and bridges the API
/// endpoints the web client needs. Everything stays inside the app process.
final class KinetixServer {
    private static let firstPort: UInt16 = 47821
    private static let lastPort: UInt16 = 47832
    private static let userAgent = "Kinetix/1.0 (iOS)"
    private static let maxBody = 4 * 1024 * 1024

    let port: UInt16

    private let root: String
    private var listener: Int32 = -1
    private var running = true
    private let acceptQueue = DispatchQueue(label: "app.kinetix.http", qos: .userInitiated)
    private let imageLock = NSLock()
    private var images: [String: CachedImage] = [:]

    private struct CachedImage {
        let type: String
        let body: Data
    }

    init() throws {
        guard let resource = Bundle.main.resourceURL?.appendingPathComponent("www").path else {
            throw KinetixError("Не найдены файлы приложения")
        }
        root = resource

        let loopback = inet_addr("127.0.0.1")
        var socketFD: Int32 = -1
        var boundPort: UInt16 = 0
        for candidate in Self.firstPort...Self.lastPort {
            let fd = socket(AF_INET, SOCK_STREAM, 0)
            if fd < 0 { continue }
            var reuse: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
            var noSigPipe: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
            var address = sockaddr_in()
            address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
            address.sin_family = sa_family_t(AF_INET)
            address.sin_port = candidate.bigEndian
            address.sin_addr = in_addr(s_addr: loopback)
            let bound = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            if bound == 0 && listen(fd, 64) == 0 {
                socketFD = fd
                boundPort = candidate
                break
            }
            close(fd)
        }
        guard socketFD >= 0 else { throw KinetixError("Нет свободного локального порта") }
        listener = socketFD
        port = boundPort
    }

    func start() {
        acceptQueue.async { [weak self] in
            guard let self = self else { return }
            while self.running {
                var clientAddress = sockaddr_in()
                var length = socklen_t(MemoryLayout<sockaddr_in>.size)
                let client = withUnsafeMutablePointer(to: &clientAddress) { pointer in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        accept(self.listener, $0, &length)
                    }
                }
                if client < 0 {
                    if self.running { continue }
                    break
                }
                var noSigPipe: Int32 = 1
                setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
                var timeout = timeval(tv_sec: 20, tv_usec: 0)
                setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                DispatchQueue.global(qos: .userInitiated).async {
                    self.handle(client)
                }
            }
        }
    }

    func stop() {
        running = false
        if listener >= 0 {
            shutdown(listener, SHUT_RDWR)
            close(listener)
            listener = -1
        }
    }

    private func handle(_ client: Int32) {
        defer { close(client) }
        let reader = SocketReader(fd: client)
        do {
            guard let request = try reader.readRequest() else {
                try sendText(client, status: 400, "Некорректный запрос")
                return
            }
            let host = request.headers["host"] ?? ""
            guard host.hasPrefix("127.0.0.1:") || host.hasPrefix("localhost:") else {
                try sendText(client, status: 403, "Недопустимый адрес")
                return
            }
            do {
                try route(request, client: client)
            } catch let error as KinetixError {
                try? sendJSON(client, status: 502, ["error": error.message])
            } catch {
                try? sendJSON(client, status: 500, ["error": "Внутренняя ошибка сервера"])
            }
        } catch {
            // The client went away before the request was complete.
        }
    }

    private func route(_ request: KinetixRequest, client: Int32) throws {
        let path = request.path
        if path == "/api/config" {
            return try sendJSON(client, status: 200, config())
        }
        if path == "/api/health" {
            return try sendJSON(client, status: 200, ["ok": true])
        }
        if path == "/api/yt-search" {
            let query = request.param("q").trimmingCharacters(in: .whitespacesAndNewlines)
            if query.isEmpty { return try sendJSON(client, status: 400, ["error": "Введите запрос"]) }
            let source = request.param("source")
            if source == "yandex" || source == "vk" {
                return try sendJSON(client, status: 400, ["error": "Этот источник недоступен в мобильной версии"])
            }
            let limit = clamp(Int(request.param("limit")) ?? 30, 1, 40)
            let tracks = try InnerTube.shared.search(String(query.prefix(160)), limit: limit, artistMode: request.param("mode") == "artist")
            return try sendJSON(client, status: 200, ["tracks": tracks])
        }
        if path == "/api/yt-related" {
            let videoId = request.param("v")
            guard isVideoId(videoId) else { return try sendJSON(client, status: 400, ["error": "Некорректный трек"]) }
            let limit = clamp(Int(request.param("limit")) ?? 24, 1, 30)
            let tracks = try InnerTube.shared.related(videoId, limit: limit)
            return try sendJSON(client, status: 200, ["tracks": tracks])
        }
        if path == "/api/yt-warm" {
            let videoId = request.param("v")
            guard isVideoId(videoId) else { return try sendJSON(client, status: 400, ["error": "Некорректный трек"]) }
            let stream = try InnerTube.shared.resolve(videoId)
            return try sendJSON(client, status: 200, ["ok": true, "type": stream.mime])
        }
        if path == "/api/yt-stream" {
            let videoId = request.param("v")
            guard isVideoId(videoId) else { return try sendJSON(client, status: 400, ["error": "Некорректный трек"]) }
            return try proxyStream(videoId, range: request.headers["range"], client: client, retry: true)
        }
        if path == "/api/artist-photo" {
            return try artistPhoto(request.param("name").trimmingCharacters(in: .whitespacesAndNewlines), client: client)
        }
        if path == "/__native/deezer" {
            let result = try InnerTube.shared.deezer(request.param("path"))
            return try sendJSON(client, status: 200, result)
        }
        if path.hasPrefix("/api/") || path.hasPrefix("/__native/") {
            return try sendJSON(client, status: 404, ["error": "Недоступно в мобильной версии"])
        }
        try staticFile(path, client: client)
    }

    private func config() -> [String: Any] {
        return [
            "ready": true,
            "android": true,
            "ios": true,
            "soundcloud": false,
            "archive": true,
            "youtube": true,
            "youtubeDl": true,
            "yandex": false,
            "yandexFull": false,
            "vk": false,
            "vkIssue": "",
            "offline": false,
            "desktop": false,
            "googleClientId": "",
            "googleSecret": false
        ]
    }

    private func proxyStream(_ videoId: String, range: String?, client: Int32, retry: Bool) throws {
        let stream = try InnerTube.shared.resolve(videoId)
        guard let url = URL(string: stream.url), !stream.url.isEmpty else {
            throw KinetixError("YouTube не отдал поток")
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 35)
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("*/*", forHTTPHeaderField: "Accept")
        if let range = range, !range.isEmpty { request.setValue(range, forHTTPHeaderField: "Range") }

        let downloader = StreamDownloader(client: client, fallbackType: stream.mime)
        downloader.run(request)

        if !downloader.headWritten {
            if (downloader.status == 403 || downloader.status == 410) && retry {
                InnerTube.shared.forget(videoId)
                return try proxyStream(videoId, range: range, client: client, retry: false)
            }
            let code = downloader.status
            let detail = downloader.detail.isEmpty ? "" : " " + downloader.detail
            throw KinetixError("YouTube не отдал поток (\(code))" + detail)
        }
    }

    private func artistPhoto(_ name: String, client: Int32) throws {
        if name.isEmpty {
            return try sendJSON(client, status: 400, ["error": "Укажите исполнителя"])
        }
        let key = name.lowercased()
        imageLock.lock()
        let cached = images[key]
        imageLock.unlock()
        if let cached = cached {
            return try sendBytes(client, status: 200, type: cached.type, body: cached.body, cache: "public, max-age=604800")
        }
        do {
            let result = try InnerTube.shared.deezer("/search/artist?q=" + encode(name) + "&limit=1")
            if let data = result["data"] as? [[String: Any]], let artist = data.first {
                let candidates = ["picture_xl", "picture_big", "picture_medium"]
                var picture = ""
                for field in candidates where picture.isEmpty {
                    let value = artist[field] as? String ?? ""
                    if !value.isEmpty { picture = value }
                }
                if !picture.isEmpty, let image = try? downloadImage(picture) {
                    imageLock.lock()
                    if images.count > 240 { images.removeAll() }
                    images[key] = image
                    imageLock.unlock()
                    return try sendBytes(client, status: 200, type: image.type, body: image.body, cache: "public, max-age=604800")
                }
            }
        } catch {
            // Fall back to the initials placeholder.
        }
        let placeholderBody = Data(placeholder(name).utf8)
        try sendBytes(client, status: 200, type: "image/svg+xml; charset=utf-8", body: placeholderBody, cache: "public, max-age=86400")
    }

    private func downloadImage(_ url: String) throws -> CachedImage {
        guard let target = URL(string: url) else { throw KinetixError("Некорректная ссылка") }
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        let (data, response) = try SyncHTTP.data(for: request, timeout: 20)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw KinetixError("Фото не загрузилось")
        }
        guard let type = http.value(forHTTPHeaderField: "Content-Type"), type.hasPrefix("image/") else {
            throw KinetixError("Фото не загрузилось")
        }
        guard !data.isEmpty, data.count <= 3_000_000 else { throw KinetixError("Фото не загрузилось") }
        return CachedImage(type: type, body: data)
    }

    private func staticFile(_ rawPath: String, client: Int32) throws {
        let path = decode(rawPath)
        guard !path.contains(".."), !path.contains("\\") else {
            return try sendText(client, status: 404, "Не найдено")
        }
        var relative = path
        if relative == "/" { relative = "/index.html" }
        if relative.hasSuffix("/") { relative += "index.html" }
        let component = relative.hasPrefix("/") ? String(relative.dropFirst()) : relative
        let file = (root as NSString).appendingPathComponent(component)
        if FileManager.default.fileExists(atPath: file), let data = try? Data(contentsOf: URL(fileURLWithPath: file)) {
            let cache = relative.hasPrefix("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
            return try sendBytes(client, status: 200, type: mime(relative), body: data, cache: cache)
        }
        let lastComponent = relative.split(separator: "/").last.map(String.init) ?? ""
        if !lastComponent.contains(".") {
            let index = (root as NSString).appendingPathComponent("index.html")
            if let data = try? Data(contentsOf: URL(fileURLWithPath: index)) {
                return try sendBytes(client, status: 200, type: "text/html; charset=utf-8", body: data, cache: "no-cache")
            }
        }
        try sendText(client, status: 404, "Не найдено")
    }

    private func mime(_ path: String) -> String {
        let lower = path.lowercased()
        guard let dot = lower.lastIndex(of: ".") else { return "application/octet-stream" }
        let suffix = String(lower[lower.index(after: dot)...])
        switch suffix {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "mp3": return "audio/mpeg"
        case "m4a": return "audio/mp4"
        case "ogg": return "audio/ogg"
        case "wav": return "audio/wav"
        case "wasm": return "application/wasm"
        case "map": return "application/json"
        default: return "application/octet-stream"
        }
    }

    private func sendJSON(_ client: Int32, status: Int, _ payload: [String: Any]) throws {
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: [])) ?? Data("{}".utf8)
        try sendBytes(client, status: status, type: "application/json; charset=utf-8", body: data, cache: "no-store")
    }

    private func sendText(_ client: Int32, status: Int, _ text: String) throws {
        try sendBytes(client, status: status, type: "text/plain; charset=utf-8", body: Data(text.utf8), cache: "no-store")
    }

    private func sendBytes(_ client: Int32, status: Int, type: String, body: Data, cache: String) throws {
        let head = "HTTP/1.1 \(status) \(Self.statusText(status))\r\n" +
            "Content-Type: \(type)\r\n" +
            "Content-Length: \(body.count)\r\n" +
            "Cache-Control: \(cache)\r\n" +
            "Connection: close\r\n\r\n"
        try Self.writeAll(client, Data(head.utf8))
        try Self.writeAll(client, body)
    }

    fileprivate static func writeAll(_ client: Int32, _ data: Data) throws {
        try data.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            var offset = 0
            while offset < raw.count {
                let written = send(client, base.advanced(by: offset), raw.count - offset, 0)
                if written <= 0 { throw KinetixError("Соединение закрыто") }
                offset += written
            }
        }
    }

    fileprivate static func statusText(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 206: return "Partial Content"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 502: return "Bad Gateway"
        default: return "Error"
        }
    }

    private func isVideoId(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil
    }

    fileprivate func clamp(_ value: Int, _ minimum: Int, _ maximum: Int) -> Int {
        max(minimum, min(maximum, value))
    }

    private func encode(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private func decode(_ value: String) -> String {
        value.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? value
    }

    private func placeholder(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let initials = trimmed.isEmpty ? "K" : String(trimmed.prefix(1)).uppercased()
        let safe = initials
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"500\" height=\"500\" viewBox=\"0 0 500 500\">" +
            "<defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#2a3b1f\"/><stop offset=\"1\" stop-color=\"#11151c\"/></linearGradient></defs>" +
            "<rect width=\"500\" height=\"500\" fill=\"url(#g)\"/><text x=\"250\" y=\"290\" font-family=\"sans-serif\" font-size=\"190\" font-weight=\"700\" fill=\"#d7ff57\" text-anchor=\"middle\">" + safe + "</text></svg>"
    }

    /// Streams a remote audio URL straight into the loopback socket.
    private final class StreamDownloader: NSObject, URLSessionDataDelegate {
        private let client: Int32
        private let fallbackType: String
        private let semaphore = DispatchSemaphore(value: 0)
        private var session: URLSession?
        private(set) var status = 0
        private(set) var headWritten = false
        private(set) var detail = ""

        init(client: Int32, fallbackType: String) {
            self.client = client
            self.fallbackType = fallbackType
        }

        func run(_ request: URLRequest) {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 35
            configuration.timeoutIntervalForResource = 3600
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            self.session = session
            session.dataTask(with: request).resume()
            _ = semaphore.wait(timeout: .now() + 120)
            session.invalidateAndCancel()
            self.session = nil
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
            guard let http = response as? HTTPURLResponse else {
                completionHandler(.cancel)
                return
            }
            status = http.statusCode
            guard status == 200 || status == 206 else {
                detail = KinetixText.shorten(http.value(forHTTPHeaderField: "Content-Type") ?? "", 80)
                completionHandler(.cancel)
                return
            }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? fallbackType
            let length = http.expectedContentLength
            var head = "HTTP/1.1 \(status) \(KinetixServer.statusText(status))\r\n"
            head += "Content-Type: \(type)\r\n"
            if length >= 0 { head += "Content-Length: \(length)\r\n" }
            if let contentRange = http.value(forHTTPHeaderField: "Content-Range") {
                head += "Content-Range: \(contentRange)\r\n"
            }
            head += "Accept-Ranges: bytes\r\nCache-Control: private, max-age=3600\r\nConnection: close\r\n\r\n"
            do {
                try KinetixServer.writeAll(client, Data(head.utf8))
                headWritten = true
                completionHandler(.allow)
            } catch {
                completionHandler(.cancel)
            }
        }

        func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
            guard headWritten else { return }
            do {
                try KinetixServer.writeAll(client, data)
            } catch {
                // The player cancelled or seeked: the response is already committed.
                dataTask.cancel()
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if status != 200 && status != 206 {
                detail = KinetixText.shorten(error?.localizedDescription ?? detail, 80)
            }
            semaphore.signal()
        }
    }
}

/// Minimal buffered reader over a blocking socket.
private final class SocketReader {
    private let fd: Int32
    private var buffer: [UInt8] = []
    private var index = 0

    init(fd: Int32) {
        self.fd = fd
    }

    private func nextByte() -> UInt8? {
        if index >= buffer.count {
            var chunk = [UInt8](repeating: 0, count: 16 * 1024)
            let count = recv(fd, &chunk, chunk.count, 0)
            if count <= 0 { return nil }
            buffer = Array(chunk[0..<count])
            index = 0
        }
        let byte = buffer[index]
        index += 1
        return byte
    }

    private func readLine(limit: Int) -> String? {
        var bytes: [UInt8] = []
        while let byte = nextByte() {
            if byte == 0x0A { break }
            if byte != 0x0D { bytes.append(byte) }
            if bytes.count > limit { return nil }
        }
        guard !bytes.isEmpty else { return nil }
        return String(bytes: bytes, encoding: .isoLatin1)
    }

    private func readBytes(_ count: Int) throws -> Data {
        var data = Data()
        data.reserveCapacity(count)
        var remaining = count
        while remaining > 0 {
            if index < buffer.count {
                let take = min(remaining, buffer.count - index)
                data.append(contentsOf: buffer[index..<(index + take)])
                index += take
                remaining -= take
                continue
            }
            var chunk = [UInt8](repeating: 0, count: min(32 * 1024, remaining))
            let got = recv(fd, &chunk, chunk.count, 0)
            if got <= 0 { throw KinetixError("Запрос оборвался") }
            data.append(contentsOf: chunk[0..<got])
            remaining -= got
        }
        return data
    }

    func readRequest() throws -> KinetixRequest? {
        guard let line = readLine(limit: 8192), !line.isEmpty else { return nil }
        let parts = line.split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count >= 2 else { return nil }
        var request = KinetixRequest()
        request.method = String(parts[0]).uppercased()
        let target = String(parts[1])
        if let question = target.firstIndex(of: "?") {
            request.path = String(target[..<question])
            let queryString = String(target[target.index(after: question)...])
            for pair in queryString.split(separator: "&") where !pair.isEmpty {
                if let equals = pair.firstIndex(of: "=") {
                    let key = decode(String(pair[..<equals]))
                    let value = decode(String(pair[pair.index(after: equals)...]))
                    request.query[key] = value
                } else {
                    request.query[decode(String(pair))] = ""
                }
            }
        } else {
            request.path = target
        }
        var headerCount = 0
        while let header = readLine(limit: 16384) {
            if header.isEmpty { break }
            headerCount += 1
            if headerCount > 80 { return nil }
            guard let colon = header.firstIndex(of: ":") else { continue }
            let name = String(header[..<colon]).trimmingCharacters(in: .whitespaces).lowercased()
            let value = String(header[header.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            request.headers[name] = value
        }
        let length = Int(request.headers["content-length"] ?? "") ?? 0
        if length > 4 * 1024 * 1024 { throw KinetixError("Слишком большой запрос") }
        if length > 0 { request.body = try readBytes(length) }
        return request
    }

    private func decode(_ value: String) -> String {
        value.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? value
    }
}

private struct KinetixRequest {
    var method = "GET"
    var path = "/"
    var query: [String: String] = [:]
    var headers: [String: String] = [:]
    var body = Data()

    func param(_ key: String) -> String { query[key] ?? "" }
}
