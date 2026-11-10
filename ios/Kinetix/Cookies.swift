import Foundation

struct ParsedCookies {
    let header: String
    let count: Int
}

/// Accepts both Netscape cookies.txt (or its Get cookies.txt LOCALLY export) and
/// JSON cookie exports, and keeps only cookies YouTube can use.
enum Cookies {
    private struct Pair {
        let name: String
        let value: String
    }

    static func parse(_ raw: String) -> ParsedCookies? {
        let text = raw.replacingOccurrences(of: "\u{FEFF}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        var values = text.hasPrefix("[") || text.hasPrefix("{") ? fromJSON(text) : fromNetscape(text)
        if values.isEmpty { values = fromRows(text) }
        if values.isEmpty { values = fromPairs(text) }
        if values.isEmpty { return nil }
        let header = values.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        return header.isEmpty ? nil : ParsedCookies(header: header, count: values.count)
    }

    private static func relevant(_ domain: String) -> Bool {
        var value = domain.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.hasPrefix(".") { value.removeFirst() }
        return value.isEmpty
            || value.hasSuffix("youtube.com")
            || value.hasSuffix("google.com")
            || value.hasSuffix("google.ru")
    }

    private static func isValidName(_ name: String) -> Bool {
        name.range(of: #"^[A-Za-z0-9_.-]+$"#, options: .regularExpression) != nil
    }

    private static func put(_ values: inout [Pair], _ name: String, _ value: String) {
        values.removeAll { $0.name == name }
        values.append(Pair(name: name, value: value))
    }

    private static func fromNetscape(_ text: String) -> [Pair] {
        var values: [Pair] = []
        for rawLine in text.components(separatedBy: .newlines) {
            var line = rawLine.replacingOccurrences(of: "\u{FEFF}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty { continue }
            if line.hasPrefix("#HttpOnly_") {
                line = String(line.dropFirst("#HttpOnly_".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            } else if line.hasPrefix("#") {
                continue
            }
            // Табы при копировании через мессенджеры превращаются в пробелы — принимаем и такой вариант.
            var cells = line.components(separatedBy: "\t")
            if cells.count < 7 {
                cells = line
                    .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .split(separator: " ")
                    .map(String.init)
            }
            if cells.count < 7 { continue }
            if !relevant(cells[0]) { continue }
            let name = cells[5].trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty { continue }
            put(&values, name, cells[6].trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return values
    }

    private static func fromRows(_ text: String) -> [Pair] {
        var values: [Pair] = []
        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty || line.hasPrefix("#") { continue }
            let cells = line.split(whereSeparator: { $0.isWhitespace }).map(String.init)
            if cells.count < 3 { continue }
            var domainAt = -1
            for index in 1..<cells.count where relevant(cells[index]) {
                domainAt = index
                break
            }
            if domainAt < 2 { continue }
            let name = cells[0]
            let value = cells[1]
            if !isValidName(name) || value.isEmpty { continue }
            put(&values, name, value)
        }
        return values
    }

    private static func fromPairs(_ text: String) -> [Pair] {
        var values: [Pair] = []
        let parts = text.components(separatedBy: CharacterSet(charactersIn: ";\r\n"))
        for part in parts {
            var cell = part.trimmingCharacters(in: .whitespacesAndNewlines)
            if cell.isEmpty { continue }
            if cell.hasPrefix("Cookie:") {
                cell = String(cell.dropFirst("Cookie:".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            guard let equals = cell.firstIndex(of: "=") else { continue }
            if equals == cell.startIndex { continue }
            let name = String(cell[..<equals]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(cell[cell.index(after: equals)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty || value.isEmpty { continue }
            if !isValidName(name) { continue }
            let lower = name.lowercased()
            if ["path", "domain", "expires", "max-age", "secure", "httponly", "samesite"].contains(lower) { continue }
            put(&values, name, value)
        }
        return values
    }

    private static func fromJSON(_ text: String) -> [Pair] {
        var values: [Pair] = []
        guard let data = text.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) else { return values }
        let list: [Any]
        if let object = root as? [String: Any], let cookies = object["cookies"] as? [Any] {
            list = cookies
        } else if let array = root as? [Any] {
            list = array
        } else {
            return values
        }
        for element in list {
            guard let item = element as? [String: Any] else { continue }
            let name = (item["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if name.isEmpty { continue }
            if !relevant(item["domain"] as? String ?? "") { continue }
            put(&values, name, item["value"] as? String ?? "")
        }
        return values
    }
}
