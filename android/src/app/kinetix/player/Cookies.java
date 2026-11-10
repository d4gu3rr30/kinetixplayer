package app.kinetix.player;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Accepts both Netscape cookies.txt (or its Get cookies.txt LOCALLY export) and
 * JSON cookie exports, and keeps only cookies YouTube can use.
 */
final class Cookies {
    static final class Parsed {
        final String header;
        final int count;

        Parsed(String header, int count) {
            this.header = header;
            this.count = count;
        }
    }

    private Cookies() {
    }

    static Parsed parse(String raw) {
        if (raw == null) return null;
        String text = raw.replace("\uFEFF", "").trim();
        if (text.isEmpty()) return null;
        Map<String, String> values = text.startsWith("[") || text.startsWith("{") ? fromJson(text) : fromNetscape(text);
        if (values.isEmpty()) values = fromRows(text);
        if (values.isEmpty()) values = fromPairs(text);
        if (values.isEmpty()) return null;
        StringBuilder header = new StringBuilder();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getKey().isEmpty()) continue;
            if (header.length() > 0) header.append("; ");
            header.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return header.length() == 0 ? null : new Parsed(header.toString(), values.size());
    }

    private static boolean relevant(String domain) {
        String value = domain == null ? "" : domain.trim().toLowerCase(Locale.ROOT).replaceFirst("^\\.", "");
        return value.isEmpty()
                || value.endsWith("youtube.com")
                || value.endsWith("google.com")
                || value.endsWith("google.ru");
    }

    private static Map<String, String> fromNetscape(String text) {
        Map<String, String> values = new LinkedHashMap<>();
        for (String rawLine : text.split("\r?\n|\r")) {
            String line = rawLine.replace("\uFEFF", "").trim();
            if (line.isEmpty()) continue;
            if (line.startsWith("#HttpOnly_")) line = line.substring("#HttpOnly_".length()).trim();
            else if (line.startsWith("#")) continue;
            // Табы при копировании через мессенджеры превращаются в пробелы — принимаем и такой вариант.
            String[] cells = line.split("\t", -1);
            if (cells.length < 7) cells = line.split("\\s+", 7);
            if (cells.length < 7) continue;
            if (!relevant(cells[0])) continue;
            String name = cells[5].trim();
            if (name.isEmpty()) continue;
            values.remove(name);
            values.put(name, cells[6].trim());
        }
        return values;
    }

    private static Map<String, String> fromRows(String text) {
        Map<String, String> values = new LinkedHashMap<>();
        for (String rawLine : text.split("\r?\n|\r")) {
            String line = rawLine.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            String[] cells = line.split("\\s+");
            if (cells.length < 3) continue;
            int domainAt = -1;
            for (int index = 1; index < cells.length; index++) {
                String cell = cells[index];
                if (!cell.isEmpty() && relevant(cell)) {
                    domainAt = index;
                    break;
                }
            }
            if (domainAt < 2) continue;
            String name = cells[0];
            String value = cells[1];
            if (!name.matches("[A-Za-z0-9_.-]+") || value.isEmpty()) continue;
            values.put(name, value);
        }
        return values;
    }

    private static Map<String, String> fromPairs(String text) {
        Map<String, String> values = new LinkedHashMap<>();
        for (String part : text.split("[;\r\n]+")) {
            String cell = part.trim();
            if (cell.startsWith("Cookie:")) cell = cell.substring("Cookie:".length()).trim();
            int equals = cell.indexOf('=');
            if (equals <= 0) continue;
            String name = cell.substring(0, equals).trim();
            String value = cell.substring(equals + 1).trim();
            if (name.isEmpty() || value.isEmpty()) continue;
            if (!name.matches("[A-Za-z0-9_.-]+")) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.equals("path") || lower.equals("domain") || lower.equals("expires") || lower.equals("max-age")
                    || lower.equals("secure") || lower.equals("httponly") || lower.equals("samesite")) continue;
            values.put(name, value);
        }
        return values;
    }

    private static Map<String, String> fromJson(String text) {
        Map<String, String> values = new LinkedHashMap<>();
        try {
            JSONArray list;
            if (text.startsWith("{")) list = new JSONObject(text).optJSONArray("cookies");
            else list = new JSONArray(text);
            if (list == null) return values;
            for (int index = 0; index < list.length(); index++) {
                JSONObject item = list.optJSONObject(index);
                if (item == null) continue;
                String name = item.optString("name", "").trim();
                if (name.isEmpty()) continue;
                if (!relevant(item.optString("domain", ""))) continue;
                values.remove(name);
                values.put(name, item.optString("value", ""));
            }
        } catch (Exception ignored) {
        }
        return values;
    }
}
