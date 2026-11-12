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

    /// A stalled upstream must not pile up connections: six audio streams are
    /// more than the player ever needs, and a seventh waits instead of freezing
    /// the whole loopback server.
    private let streamSlots = DispatchSemaphore(value: 6)
    private let streamLock = NSLock()
    private var activeStreams: [String: StreamDownloader] = [:]

    // WebKit pulls a track in many small range requests, and googlevideo answers
    // 403 on the first try of nearly every one. Downloading the whole file once
    // and serving every range from memory turns dozens of slow round-trips into
    // a single fetch, so playback starts in seconds instead of minutes.
    private let audioLock = NSLock()
    private var audioCache: [String: CachedAudio] = [:]
    private var audioOrder: [String] = []
    private let audioDownloadQueue = DispatchQueue(label: "app.kinetix.audio.download")

    private struct CachedAudio {
        let data: Data
        let type: String
    }

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
            return try proxyStream(videoId, range: request.headers["range"], client: client)
        }
        if path == "/api/integrations" {
            if request.method == "POST" { return try saveIntegrations(request, client: client) }
            return try sendJSON(client, status: 200, integrations())
        }
        if path == "/api/youtube-auth" {
            if request.method == "POST" { return try saveYouTubeAuth(request, client: client) }
            if request.method == "DELETE" { return try clearYouTubeAuth(client: client) }
            return try sendJSON(client, status: 200, youtubeStatus())
        }
        if path == "/api/youtube-auth/test" {
            return try testYouTube(client: client)
        }
        if path == "/api/vk-search" {
            let query = request.param("q").trimmingCharacters(in: .whitespacesAndNewlines)
            if query.isEmpty { return try sendJSON(client, status: 400, ["error": "Введите запрос"]) }
            let token = NativeStore.shared.vk
            if token.isEmpty { return try sendJSON(client, status: 400, ["error": "Добавьте токен ВКонтакте в настройках"]) }
            let limit = clamp(Int(request.param("limit")) ?? 30, 1, 50)
            let offset = clamp(Int(request.param("offset")) ?? 0, 0, 200)
            let artist = request.param("mode") == "artist"
            let tracks = try VkClient.search(token: token, query: String(query.prefix(160)), limit: limit, artist: artist, offset: offset)
            return try sendJSON(client, status: 200, ["tracks": tracks])
        }
        if path == "/api/yandex-search" {
            let query = request.param("q").trimmingCharacters(in: .whitespacesAndNewlines)
            if query.isEmpty { return try sendJSON(client, status: 400, ["error": "Введите запрос"]) }
            let token = NativeStore.shared.yandex
            if token.isEmpty { return try sendJSON(client, status: 400, ["error": "Добавьте токен Яндекс Музыки в настройках"]) }
            let limit = clamp(Int(request.param("limit")) ?? 30, 1, 50)
            let tracks = try YandexClient.search(token: token, query: String(query.prefix(160)), limit: limit)
            return try sendJSON(client, status: 200, ["tracks": tracks])
        }
        if path == "/api/vk-stream" {
            let id = request.param("id")
            guard id.range(of: #"^(?:vk:)?-?\d+_\d+$"#, options: .regularExpression) != nil else {
                return try sendJSON(client, status: 400, ["error": "Некорректный трек"])
            }
            let token = NativeStore.shared.vk
            if token.isEmpty { return try sendJSON(client, status: 400, ["error": "Добавьте токен ВКонтакте в настройках"]) }
            let stream = try VkClient.resolve(token: token, rawId: id)
            return try proxyRemote(stream.url, fallbackType: "audio/mpeg", range: request.headers["range"], client: client, refresh: {
                VkClient.forget(id)
                return try VkClient.resolve(token: token, rawId: id).url
            })
        }
        if path == "/api/yandex-stream" {
            let id = request.param("id")
            guard id.range(of: #"^\d{1,20}$"#, options: .regularExpression) != nil else {
                return try sendJSON(client, status: 400, ["error": "Некорректный трек"])
            }
            let token = NativeStore.shared.yandex
            if token.isEmpty { return try sendJSON(client, status: 400, ["error": "Добавьте токен Яндекс Музыки в настройках"]) }
            let stream = try YandexClient.resolve(token: token, track: id)
            return try proxyRemote(stream.url, fallbackType: stream.type, range: request.headers["range"], client: client, refresh: {
                YandexClient.forget(id)
                return try YandexClient.resolve(token: token, track: id).url
            })
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
        let vk = !NativeStore.shared.vk.isEmpty
        let yandex = !NativeStore.shared.yandex.isEmpty
        return [
            "ready": true,
            "android": true,
            "ios": true,
            "soundcloud": false,
            "archive": true,
            "youtube": true,
            "youtubeDl": true,
            "yandex": true,
            "yandexFull": yandex,
            "vk": vk,
            "vkIssue": "",
            "offline": false,
            "desktop": false,
            "googleClientId": "",
            "googleSecret": false
        ]
    }

    private func tokenStatus(_ value: String) -> [String: Any] {
        ["set": !value.isEmpty, "length": value.count]
    }

    private func integrations() -> [String: Any] {
        [
            "vk": tokenStatus(NativeStore.shared.vk),
            "yandex": tokenStatus(NativeStore.shared.yandex),
            "google": tokenStatus(""),
            "googleSecret": tokenStatus(""),
            "ytProxy": tokenStatus(NativeStore.shared.ytProxy)
        ]
    }

    private func youtubeStatus() -> [String: Any] {
        let store = NativeStore.shared
        let on = store.hasCookies
        return [
            "mode": on ? "file" : "off",
            "browser": "",
            "cookieCount": store.cookieCount,
            "updatedAt": store.cookieUpdated,
            "ytDlp": true,
            "usingEnv": false
        ]
    }

    private func jsonBody(_ request: KinetixRequest) -> [String: Any]? {
        if request.body.isEmpty { return nil }
        guard let value = try? JSONSerialization.jsonObject(with: request.body) else { return nil }
        return value as? [String: Any]
    }

    private func saveIntegrations(_ request: KinetixRequest, client: Int32) throws {
        guard let payload = jsonBody(request) else {
            return try sendJSON(client, status: 400, ["error": "Некорректный запрос"])
        }
        for name in ["vk", "yandex"] {
            guard let raw = payload[name], !(raw is NSNull) else { continue }
            let value = (raw as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if value.count > 4096 {
                return try sendJSON(client, status: 400, ["error": "Токен слишком длинный"])
            }
            NativeStore.shared.setToken(name, value)
        }
        if let raw = payload["ytProxy"], !(raw is NSNull) {
            let value = (raw as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if value.count > 512 {
                return try sendJSON(client, status: 400, ["error": "Адрес прокси слишком длинный"])
            }
            if !value.isEmpty && ProxyConfig.parse(value) == nil {
                return try sendJSON(client, status: 400, ["error": "Не похоже на адрес прокси. Пример: http://1.2.3.4:8080 или socks5://1.2.3.4:1080"])
            }
            NativeStore.shared.setYTProxy(value)
            InnerTube.shared.setProxy(value)
        }
        try sendJSON(client, status: 200, integrations())
    }

    private func saveYouTubeAuth(_ request: KinetixRequest, client: Int32) throws {
        guard let payload = jsonBody(request) else {
            return try sendJSON(client, status: 400, ["error": "Некорректный запрос"])
        }
        let mode = payload["mode"] as? String ?? "file"
        if mode == "off" {
            return try clearYouTubeAuth(client: client)
        }
        if mode == "browser" {
            return try sendJSON(client, status: 400, ["error": "На iPhone cookies можно только вставить файлом"])
        }
        guard let parsed = Cookies.parse(payload["cookies"] as? String ?? "") else {
            return try sendJSON(client, status: 400, ["error": "В cookies не нашлось данных YouTube. Нужен cookies.txt (Netscape) или JSON-экспорт целиком"])
        }
        NativeStore.shared.saveCookies(header: parsed.header, count: parsed.count)
        InnerTube.shared.setCookies(parsed.header)
        try sendJSON(client, status: 200, youtubeStatus())
    }

    private func clearYouTubeAuth(client: Int32) throws {
        NativeStore.shared.clearCookies()
        InnerTube.shared.setCookies("")
        try sendJSON(client, status: 200, youtubeStatus())
    }

    private func testYouTube(client: Int32) throws {
        do {
            let tracks = try InnerTube.shared.search("music", limit: 1, artistMode: false)
            let title = tracks.first?["title"] as? String ?? ""
            try sendJSON(client, status: 200, ["ok": true, "title": title])
        } catch {
            let reason = error.localizedDescription
            try sendJSON(client, status: 200, ["ok": false, "error": reason.isEmpty ? "YouTube не ответил" : reason])
        }
    }

    private func beginStream(_ key: String) throws {
        streamLock.lock()
        let stale = activeStreams[key]
        streamLock.unlock()
        stale?.cancel()
        guard streamSlots.wait(timeout: .now() + 10) == .success else {
            throw KinetixError("Сеть не успевает загрузить поток. Проверьте VPN и попробуйте снова")
        }
    }

    private func endStream(_ key: String, downloader: StreamDownloader?) {
        if let downloader {
            streamLock.lock()
            if activeStreams[key] === downloader { activeStreams.removeValue(forKey: key) }
            streamLock.unlock()
        }
        streamSlots.signal()
    }

    private func registerStream(_ downloader: StreamDownloader, key: String) {
        streamLock.lock()
        activeStreams[key] = downloader
        streamLock.unlock()
    }

    private func noteStreamResult(_ downloader: StreamDownloader, scope: String) {
        // A seek or a newer retry cancels the old transfer on purpose; that is
        // not evidence that the network itself is down.
        if downloader.wasCanceled { return }
        if downloader.headWritten || downloader.status != 0 {
            NetworkGate.success(scope)
        } else {
            NetworkGate.failure(scope)
        }
    }

    private func proxyRemote(_ url: String, fallbackType: String, range: String?, client: Int32, refresh: (() throws -> String)?) throws {
        guard let target = URL(string: url), !url.isEmpty else { throw KinetixError("Источник не отдал поток") }
        try NetworkGate.check("remote")
        // Parallel byte-range requests for one file are legitimate; only the
        // exact same request (a retry of the same offset) replaces its transfer.
        let key = "url:" + url + "|" + (range ?? "full")
        try beginStream(key)
        var downloader: StreamDownloader?
        var released = false
        defer { if !released { endStream(key, downloader: downloader) } }

        var upstream = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 35)
        upstream.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        upstream.setValue("*/*", forHTTPHeaderField: "Accept")
        // googlevideo/CDN throttle plain 200 downloads to a crawl; a byte range
        // makes them stream at full speed even when the client sent no Range.
        let requestedRange = range.flatMap { $0.isEmpty ? nil : $0 }
        upstream.setValue(requestedRange ?? "bytes=0-", forHTTPHeaderField: "Range")

        let active = StreamDownloader(client: client, fallbackType: fallbackType, fullResponse: requestedRange == nil)
        downloader = active
        registerStream(active, key: key)
        active.run(upstream)
        kinetixLog.info("remote stream host=\(target.host ?? "?", privacy: .public) range=\(requestedRange ?? "bytes=0-", privacy: .public) status=\(active.status)")

        if !active.headWritten {
            noteStreamResult(active, scope: "remote")
            if let refresh = refresh, active.status == 403 || active.status == 404 || active.status == 410 {
                let fresh = try refresh()
                endStream(key, downloader: active)
                downloader = nil
                released = true
                return try proxyRemote(fresh, fallbackType: fallbackType, range: range, client: client, refresh: nil)
            }
            let detail = active.detail.isEmpty ? "" : " " + active.detail
            throw KinetixError("Источник не отдал поток (\(active.status))" + detail)
        }
        noteStreamResult(active, scope: "remote")
    }

    private func proxyStream(_ videoId: String, range: String?, client: Int32) throws {
        try NetworkGate.check("yt")
        let key = "yt:" + videoId
        try beginStream(key)
        defer { endStream(key, downloader: nil) }
        do {
            let cached = try ensureAudio(videoId)
            try serveAudio(cached, range: range, client: client)
            NetworkGate.success("yt")
        } catch {
            if NetworkGate.isNetwork(error) { NetworkGate.failure("yt") }
            throw error
        }
    }

    /// Returns the fully downloaded track, fetching it once per video. Concurrent
    /// range requests serialize on one queue so the file is never pulled twice.
    private func ensureAudio(_ videoId: String) throws -> CachedAudio {
        audioLock.lock()
        if let cached = audioCache[videoId] {
            touchAudio(videoId)
            audioLock.unlock()
            return cached
        }
        audioLock.unlock()
        return try audioDownloadQueue.sync {
            audioLock.lock()
            if let cached = audioCache[videoId] {
                touchAudio(videoId)
                audioLock.unlock()
                return cached
            }
            audioLock.unlock()
            let cached = try downloadFullAudio(videoId)
            audioLock.lock()
            audioCache[videoId] = cached
            audioOrder.append(videoId)
            evictAudio()
            audioLock.unlock()
            return cached
        }
    }

    private func downloadFullAudio(_ videoId: String) throws -> CachedAudio {
        var lastReason = "YouTube не отдал поток"
        for round in 0..<2 {
            let stream = try InnerTube.shared.resolve(videoId)
            guard let url = URL(string: stream.url), !stream.url.isEmpty else {
                throw KinetixError("YouTube не отдал поток")
            }
            do {
                let data = try fetchBoundedAudio(url, stream: stream, videoId: videoId)
                return CachedAudio(data: data, type: stream.mime)
            } catch {
                lastReason = error.localizedDescription
            }
            if round == 0 {
                InnerTube.shared.rotate()
                InnerTube.shared.forget(videoId)
            }
        }
        throw KinetixError(lastReason)
    }

    /// googlevideo детерминированно отвечает 403 на открытый Range `bytes=0-`,
    /// но отдаёт ограниченный диапазон целиком (206). Размер берём из `clen`
    /// ссылки или пробы `bytes=0-1`, затем качаем bounded `bytes=0-(total-1)`.
    private func fetchBoundedAudio(_ url: URL, stream: InnerTube.Stream, videoId: String) throws -> Data {
        var total = Self.clenFromURL(url)
        if total <= 0 {
            let (probe, response) = try audioRequest(url, stream: stream, videoId: videoId, range: "bytes=0-1", label: "probe")
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if code == 200, probe.count > 2 { return probe }
            total = Self.totalFromContentRange(response)
            if total <= 0 { total = probe.count }
        }
        guard total > 0 else { throw KinetixError("YouTube не отдал размер трека") }
        let (data, response) = try audioRequest(url, stream: stream, videoId: videoId, range: "bytes=0-\(total - 1)", label: "full")
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if (200...299).contains(code), !data.isEmpty {
            kinetixLog.info("yt audio \(videoId, privacy: .public) client=\(stream.tag, privacy: .public) bytes=\(data.count) status=\(code) total=\(total)")
            return data
        }
        throw KinetixError("YouTube не отдал поток (\(code))")
    }

    /// Свежая ephemeral-сессия на каждую попытку: VPN ротирует exit-IP между
    /// соединениями, а ссылка привязана к IP. Общее соединение «прибилось» бы к
    /// неверному IP и давало 403 на всех ретраях (регресс буферизации).
    private func audioRequest(_ url: URL, stream: InnerTube.Stream, videoId: String, range: String, label: String) throws -> (Data, URLResponse) {
        var lastBody = ""
        var lastError = "YouTube не отдал поток"
        for attempt in 0..<5 {
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            // googlevideo rejects URLs fetched with a different client's User-Agent.
            request.setValue(stream.userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue("*/*", forHTTPHeaderField: "Accept")
            request.setValue(range, forHTTPHeaderField: "Range")
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.timeoutIntervalForResource = 120
            if let proxy = InnerTube.shared.proxyConfig { configuration.connectionProxyDictionary = proxy.dictionary }
            let session = URLSession(configuration: configuration)
            do {
                let (data, response) = try SyncHTTP.data(for: request, timeout: 90, gate: "yt", session: session)
                session.finishTasksAndInvalidate()
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                if (200...299).contains(code) { return (data, response) }
                lastCode = code
                lastBody = KinetixText.shorten(String(decoding: data.prefix(160), as: UTF8.self), 120)
                lastError = "YouTube не отдал поток (\(code))"
                kinetixLog.info("yt audio \(videoId, privacy: .public) \(label, privacy: .public) client=\(stream.tag, privacy: .public) range=\(range, privacy: .public) status=\(code) attempt=\(attempt)")
            } catch {
                session.finishTasksAndInvalidate()
                lastError = error.localizedDescription
                kinetixLog.error("yt audio \(videoId, privacy: .public) \(label, privacy: .public) error: \(error.localizedDescription, privacy: .public)")
            }
            if attempt < 4 { Thread.sleep(forTimeInterval: 0.35) }
        }
        throw KinetixError(lastBody.isEmpty ? lastError : lastError + " " + lastBody)
    }

    private static func clenFromURL(_ url: URL) -> Int {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        if let value = items?.first(where: { $0.name == "clen" })?.value, let number = Int(value) { return number }
        return 0
    }

    private static func totalFromContentRange(_ response: URLResponse) -> Int {
        guard let header = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Range"),
              let slash = header.lastIndex(of: "/") else { return 0 }
        return Int(header[header.index(after: slash)...].trimmingCharacters(in: .whitespaces)) ?? 0
    }

    private func serveAudio(_ cached: CachedAudio, range: String?, client: Int32) throws {
        let total = cached.data.count
        let requestedRange = range.flatMap { $0.isEmpty ? nil : $0 }
        if let requestedRange, let bounds = parseRange(requestedRange, total: total) {
            let slice = cached.data.subdata(in: bounds.0..<(bounds.1 + 1))
            let head = "HTTP/1.1 206 Partial Content\r\n" +
                "Content-Type: \(cached.type)\r\n" +
                "Content-Length: \(slice.count)\r\n" +
                "Content-Range: bytes \(bounds.0)-\(bounds.1)/\(total)\r\n" +
                "Accept-Ranges: bytes\r\nCache-Control: private, max-age=3600\r\nConnection: close\r\n\r\n"
            try Self.writeAll(client, Data(head.utf8))
            try Self.writeAll(client, slice)
            return
        }
        try sendBytes(client, status: 200, type: cached.type, body: cached.data, cache: "private, max-age=3600")
    }

    private func parseRange(_ header: String, total: Int) -> (Int, Int)? {
        guard total > 0, header.hasPrefix("bytes=") else { return nil }
        let spec = header.dropFirst(6)
        guard !spec.contains(",") else { return nil }
        let parts = spec.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let startText = String(parts[0])
        let endText = String(parts[1])
        if startText.isEmpty {
            guard let suffix = Int(endText), suffix > 0 else { return nil }
            return (max(0, total - suffix), total - 1)
        }
        guard let start = Int(startText), start >= 0, start < total else { return nil }
        let end = endText.isEmpty ? total - 1 : min(Int(endText) ?? (total - 1), total - 1)
        guard end >= start else { return nil }
        return (start, end)
    }

    private func touchAudio(_ key: String) {
        if let index = audioOrder.firstIndex(of: key) {
            audioOrder.remove(at: index)
            audioOrder.append(key)
        }
    }

    private func evictAudio() {
        while audioOrder.count > 6 || audioCache.values.reduce(0, { $0 + $1.data.count }) > 64 * 1024 * 1024 {
            guard let oldest = audioOrder.first else { break }
            audioOrder.removeFirst()
            audioCache.removeValue(forKey: oldest)
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
        private let fullResponse: Bool
        private let proxy: ProxyConfig?
        private let semaphore = DispatchSemaphore(value: 0)
        private let lock = NSLock()
        private var session: URLSession?
        private var canceled = false
        private var errorBody = Data()
        private(set) var status = 0
        private(set) var headWritten = false
        private(set) var detail = ""

        init(client: Int32, fallbackType: String, fullResponse: Bool, proxy: ProxyConfig? = nil) {
            self.client = client
            self.fallbackType = fallbackType
            self.fullResponse = fullResponse
            self.proxy = proxy
        }

        /// Called when the player seeks or retries the same track: the old
        /// transfer is useless and used to keep a thread blocked for minutes.
        func cancel() {
            lock.lock()
            if canceled { lock.unlock(); return }
            canceled = true
            let session = self.session
            lock.unlock()
            session?.invalidateAndCancel()
        }

        var wasCanceled: Bool {
            lock.lock()
            defer { lock.unlock() }
            return canceled
        }

        func run(_ request: URLRequest) {
            let configuration = URLSessionConfiguration.ephemeral
            // A stalled VPN resolver must fail the stream quickly instead of
            // holding the player for 35 seconds per attempt.
            configuration.timeoutIntervalForRequest = 15
            configuration.timeoutIntervalForResource = 3600
            if let proxy { configuration.connectionProxyDictionary = proxy.dictionary }
            let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
            lock.lock()
            self.session = session
            let canceledNow = canceled
            lock.unlock()
            if canceledNow {
                session.invalidateAndCancel()
                return
            }
            session.dataTask(with: request).resume()
            // The transfer may legitimately take minutes on a slow VPN: the
            // 15s idle timeout above already kills dead networks, so wait for
            // the real end instead of cutting the player's socket mid-track.
            _ = semaphore.wait(timeout: .now() + 3600)
            lock.lock()
            self.session = nil
            lock.unlock()
            session.invalidateAndCancel()
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
            // The client asked for no range, so answer with a whole-file 200 even
            // though the upstream request carried `Range: bytes=0-`.
            let clientStatus = fullResponse ? 200 : status
            var head = "HTTP/1.1 \(clientStatus) \(KinetixServer.statusText(clientStatus))\r\n"
            head += "Content-Type: \(type)\r\n"
            if length >= 0 { head += "Content-Length: \(length)\r\n" }
            if !fullResponse, let contentRange = http.value(forHTTPHeaderField: "Content-Range") {
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
            guard headWritten else {
                if status != 200 && status != 206 && errorBody.count < 160 {
                    errorBody.append(data.prefix(160 - errorBody.count))
                }
                return
            }
            do {
                try KinetixServer.writeAll(client, data)
            } catch {
                // The player cancelled or seeked: the response is already committed.
                dataTask.cancel()
            }
        }

        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if status != 200 && status != 206 {
                if !errorBody.isEmpty {
                    detail = KinetixText.shorten(String(decoding: errorBody, as: UTF8.self), 120)
                } else if let error {
                    detail = KinetixText.shorten(error.localizedDescription, 80)
                }
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
