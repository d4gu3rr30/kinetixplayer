package app.kinetix.player;

import android.content.Context;
import android.content.SharedPreferences;

/** Tokens and YouTube cookies kept in app-private storage. */
final class NativeStore {
    private static final String PREFS = "kinetix-native";
    private static final String KEY_VK = "token.vk";
    private static final String KEY_YANDEX = "token.yandex";
    private static final String KEY_COOKIES = "youtube.cookies";
    private static final String KEY_COOKIE_COUNT = "youtube.count";
    private static final String KEY_COOKIE_UPDATED = "youtube.updated";

    private final SharedPreferences prefs;

    NativeStore(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String vk() {
        return prefs.getString(KEY_VK, "");
    }

    String yandex() {
        return prefs.getString(KEY_YANDEX, "");
    }

    String cookies() {
        return prefs.getString(KEY_COOKIES, "");
    }

    int cookieCount() {
        return prefs.getInt(KEY_COOKIE_COUNT, 0);
    }

    long cookieUpdated() {
        return prefs.getLong(KEY_COOKIE_UPDATED, 0L);
    }

    boolean hasCookies() {
        return cookieCount() > 0 && !cookies().isEmpty();
    }

    void setToken(String name, String value) {
        String key = "vk".equals(name) ? KEY_VK : KEY_YANDEX;
        prefs.edit().putString(key, value).apply();
    }

    void saveCookies(String header, int count) {
        prefs.edit()
                .putString(KEY_COOKIES, header)
                .putInt(KEY_COOKIE_COUNT, count)
                .putLong(KEY_COOKIE_UPDATED, System.currentTimeMillis())
                .apply();
    }

    void clearCookies() {
        prefs.edit()
                .remove(KEY_COOKIES)
                .putInt(KEY_COOKIE_COUNT, 0)
                .putLong(KEY_COOKIE_UPDATED, System.currentTimeMillis())
                .apply();
    }
}
