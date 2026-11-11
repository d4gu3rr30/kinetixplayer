import UIKit
import WebKit

final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private static let background = UIColor(red: 8 / 255, green: 8 / 255, blue: 12 / 255, alpha: 1)

    private var webView: WKWebView!
    private var server: KinetixServer?
    private var keyboardToken: NSObjectProtocol?

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.background

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.ignoresViewportScaleLimits = false
        configuration.userContentController.add(self, name: "kinetixFile")
        configuration.userContentController.add(self, name: "kinetixNow")
        configuration.userContentController.addUserScript(WKUserScript(source: Self.bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = Self.background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        // The player is a fixed app surface: pinch and double-tap zoom only
        // break the layout, so the viewport stays at 1:1.
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.bouncesZoom = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        view.addSubview(webView)
        NowPlaying.shared.attach(webView)

        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleBackSwipe(_:)))
        edge.edges = .left
        webView.addGestureRecognizer(edge)

        do {
            let server = try KinetixServer()
            server.start()
            self.server = server
            if let url = URL(string: "http://127.0.0.1:\(server.port)/?android=1&ios=1") {
                webView.load(URLRequest(url: url))
            }
        } catch {
            showFatal(error.localizedDescription)
        }

        // WKWebView keeps its frame under the keyboard, so bottom sheets would
        // hide behind it. Mirror the visible height into the CSS viewport vars.
        keyboardToken = NotificationCenter.default.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] notification in
            guard let self, let webView = self.webView else { return }
            let frame = (notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
            let overlap = max(0, self.view.bounds.maxY - self.view.convert(frame, from: nil).minY)
            let script = "document.documentElement.style.setProperty('--kb-inset','\(Int(overlap))px');if(window.__kinetixSyncViewport)window.__kinetixSyncViewport()"
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    deinit {
        if let keyboardToken { NotificationCenter.default.removeObserver(keyboardToken) }
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "kinetixFile")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "kinetixNow")
        server?.stop()
    }

    private static let bridgeScript = """
    window.kinetixAndroid = {
      saveFile: function (name, mime, base64) {
        try {
          window.webkit.messageHandlers.kinetixFile.postMessage({ name: String(name || ''), mime: String(mime || ''), data: String(base64 || '') })
          return true
        } catch (error) {
          return false
        }
      }
    }
    window.kinetixNow = {
      update: function (payload) {
        try {
          window.webkit.messageHandlers.kinetixNow.postMessage(payload || {})
          return true
        } catch (error) {
          return false
        }
      }
    }
    try {
      var blockGesture = function (event) { event.preventDefault() }
      document.addEventListener('gesturestart', blockGesture, { passive: false })
      document.addEventListener('gesturechange', blockGesture, { passive: false })
      document.addEventListener('touchmove', function (event) { if (event.touches.length > 1) event.preventDefault() }, { passive: false })
    } catch (error) { }
    """

    @objc private func handleBackSwipe(_ recognizer: UIScreenEdgePanGestureRecognizer) {
        guard recognizer.state == .ended else { return }
        webView.evaluateJavaScript("(function(){try{return window.__kinetixAndroidBack?window.__kinetixAndroidBack()===true:false}catch(e){return false}})()") { [weak self] result, _ in
            guard let self else { return }
            var handled = false
            if let number = result as? NSNumber { handled = number.boolValue }
            else if let flag = result as? Bool { handled = flag }
            if !handled && self.webView.canGoBack { self.webView.goBack() }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if message.name == "kinetixNow" {
            NowPlaying.shared.handle(body)
            return
        }
        guard message.name == "kinetixFile" else { return }
        guard let base64 = body["data"] as? String, !base64.isEmpty else { return }
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters), !data.isEmpty else { return }
        let target = FileManager.default.temporaryDirectory.appendingPathComponent(sanitizeName(body["name"] as? String))
        do {
            try data.write(to: target, options: .atomic)
        } catch {
            return
        }
        let share = UIActivityViewController(activityItems: [target], applicationActivities: nil)
        if let popover = share.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 40, width: 1, height: 1)
        }
        present(share, animated: true)
    }

    private func sanitizeName(_ name: String?) -> String {
        var value = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { value = "kinetix-file" }
        value = value.replacingOccurrences(of: #"[^\p{L}\p{N}._-]+"#, with: "_", options: .regularExpression)
        if value.count > 120 { value = String(value.suffix(120)) }
        return value
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        let host = url.host?.lowercased() ?? ""
        if (scheme == "http" || scheme == "https") && (host == "127.0.0.1" || host == "localhost") {
            decisionHandler(.allow)
            return
        }
        if scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Ок", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    private func showFatal(_ message: String) {
        let safe = message.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
        let html = """
        <!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
        <style>body{margin:0;padding:64px 28px;background:#08080c;color:#f4f1e8;font:16px/1.6 -apple-system,sans-serif}
        h1{font-size:28px;letter-spacing:-.02em;margin:0 0 12px}b{color:#d7ff57}p{color:#a7a49c}</style></head><body>
        <h1>Kinetix не запустился.</h1><p>\(safe)</p><p>Перезапусти приложение. Если ошибка повторяется — переустанови сборку.</p></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}
