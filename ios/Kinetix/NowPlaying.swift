import MediaPlayer
import UIKit
import WebKit

/// Bridges the web player to the system Now Playing panel: lock screen,
/// Control Center and the Dynamic Island.
///
/// Playback itself belongs to WebKit and its background audio keeps the app
/// alive. Running another AVAudioPlayer here would activate this process's
/// audio session, and that activation interrupts WebKit's session — music
/// pauses mid-track and resumes behind a JS state that still says "paused".
final class NowPlaying: NSObject {
    static let shared = NowPlaying()

    private weak var webView: WKWebView?
    private var artworkKey = ""
    private var artworkCache: [String: MPMediaItemArtwork] = [:]
    private var artworkTask: URLSessionDataTask?

    private lazy var placeholderArtwork: MPMediaItemArtwork = {
        let size = CGSize(width: 512, height: 512)
        let renderer = UIGraphicsImageRenderer(size: size)
        let image = renderer.image { context in
            let colors = [UIColor(red: 0.16, green: 0.21, blue: 0.13, alpha: 1).cgColor,
                          UIColor(red: 0.05, green: 0.05, blue: 0.07, alpha: 1).cgColor] as CFArray
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])
            context.cgContext.drawLinearGradient(gradient!, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            let glow = UIBezierPath(ovalIn: CGRect(x: 136, y: 136, width: 240, height: 240))
            UIColor(red: 0.84, green: 1, blue: 0.34, alpha: 1).setFill()
            glow.fill()
            let letter = NSAttributedString(string: "K", attributes: [
                .font: UIFont.systemFont(ofSize: 168, weight: .heavy),
                .foregroundColor: UIColor(red: 0.07, green: 0.1, blue: 0.05, alpha: 1),
            ])
            let bounds = letter.size()
            letter.draw(at: CGPoint(x: (size.width - bounds.width) / 2, y: (size.height - bounds.height) / 2))
        }
        return MPMediaItemArtwork(boundsSize: size) { _ in image }
    }()

    private override init() {
        super.init()
        configureRemoteCommands()
    }

    func attach(_ webView: WKWebView) {
        self.webView = webView
    }

    func handle(_ body: [String: Any]) {
        let action = body["action"] as? String ?? "update"
        if action == "clear" {
            clear()
            return
        }
        update(
            title: body["title"] as? String ?? "",
            artist: body["artist"] as? String ?? "",
            artwork: body["artwork"] as? String ?? "",
            duration: number(body["duration"]),
            elapsed: number(body["elapsed"]),
            rate: number(body["rate"])
        )
    }

    private func number(_ value: Any?) -> Double {
        if let number = value as? NSNumber { return number.doubleValue }
        if let string = value as? String { return Double(string) ?? 0 }
        return 0
    }

    private func update(title: String, artist: String, artwork: String, duration: Double, elapsed: Double, rate: Double) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title.isEmpty ? "Kinetix" : title,
            MPMediaItemPropertyArtist: artist.isEmpty ? "Kinetix" : artist,
            MPMediaItemPropertyAlbumTitle: "Kinetix",
            MPMediaItemPropertyPlaybackDuration: max(0, duration),
            MPNowPlayingInfoPropertyElapsedPlaybackTime: max(0, elapsed),
            MPNowPlayingInfoPropertyPlaybackRate: rate,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyIsLiveStream: false,
        ]
        if let cover = artworkItem(for: artwork) {
            info[MPMediaItemPropertyArtwork] = cover
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        if #available(iOS 13.0, *) {
            MPNowPlayingInfoCenter.default().playbackState = rate > 0 ? .playing : .paused
        }
    }

    private func clear() {
        artworkKey = ""
        artworkTask?.cancel()
        artworkTask = nil
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        if #available(iOS 13.0, *) {
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
    }

    // MARK: - Artwork

    private func artworkItem(for urlString: String) -> MPMediaItemArtwork? {
        if urlString.isEmpty { return placeholderArtwork }
        if let cached = artworkCache[urlString] { return cached }
        guard artworkKey != urlString else { return placeholderArtwork }
        artworkKey = urlString
        artworkTask?.cancel()
        guard let url = URL(string: urlString) else { return placeholderArtwork }
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data, let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                if self.artworkCache.count > 24 { self.artworkCache.removeAll() }
                self.artworkCache[urlString] = artwork
                guard self.artworkKey == urlString, var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artworkTask?.resume()
        return placeholderArtwork
    }

    // MARK: - Remote commands

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true

        center.playCommand.addTarget { [weak self] _ in self?.send("play"); return .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.send("pause"); return .success }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in self?.send("toggle"); return .success }
        center.nextTrackCommand.addTarget { [weak self] _ in self?.send("next"); return .success }
        center.previousTrackCommand.addTarget { [weak self] _ in self?.send("previous"); return .success }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.send("seek", value: event.positionTime)
            return .success
        }
    }

    private func send(_ action: String, value: Double? = nil) {
        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.webView else { return }
            let call = value.map { "window.__kinetixRemote&&window.__kinetixRemote('\(action)',\($0))" }
                ?? "window.__kinetixRemote&&window.__kinetixRemote('\(action)')"
            webView.evaluateJavaScript(call, completionHandler: nil)
        }
    }
}
