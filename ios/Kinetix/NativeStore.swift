import Foundation

/// Tokens and YouTube cookies kept in app-private storage.
final class NativeStore {
    static let shared = NativeStore()

    private static let keyVK = "token.vk"
    private static let keyYandex = "token.yandex"
    private static let keyCookies = "youtube.cookies"
    private static let keyCookieCount = "youtube.count"
    private static let keyCookieUpdated = "youtube.updated"
    private static let keyYTProxy = "youtube.proxy"

    private let defaults = UserDefaults.standard

    private init() {}

    var vk: String { defaults.string(forKey: Self.keyVK) ?? "" }

    var yandex: String { defaults.string(forKey: Self.keyYandex) ?? "" }

    var ytProxy: String { defaults.string(forKey: Self.keyYTProxy) ?? "" }

    func setYTProxy(_ value: String) { defaults.set(value, forKey: Self.keyYTProxy) }

    var cookies: String { defaults.string(forKey: Self.keyCookies) ?? "" }

    var cookieCount: Int { defaults.integer(forKey: Self.keyCookieCount) }

    /// Milliseconds, same as the Android store, so the status JSON stays identical.
    var cookieUpdated: Double { defaults.double(forKey: Self.keyCookieUpdated) }

    var hasCookies: Bool { cookieCount > 0 && !cookies.isEmpty }

    func setToken(_ name: String, _ value: String) {
        defaults.set(value, forKey: name == "vk" ? Self.keyVK : Self.keyYandex)
    }

    func saveCookies(header: String, count: Int) {
        defaults.set(header, forKey: Self.keyCookies)
        defaults.set(count, forKey: Self.keyCookieCount)
        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: Self.keyCookieUpdated)
    }

    func clearCookies() {
        defaults.removeObject(forKey: Self.keyCookies)
        defaults.set(0, forKey: Self.keyCookieCount)
        defaults.set(Date().timeIntervalSince1970 * 1000, forKey: Self.keyCookieUpdated)
    }
}
