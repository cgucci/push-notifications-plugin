package me.connorgooch.serverDashboard;

import java.lang.reflect.Array;
import java.util.Map;

/** Small JSON writer so the plugin does not depend on server-bundled libraries. */
final class Json {
    private Json() {}

    static String encode(Object value) {
        var out = new StringBuilder();
        append(out, value);
        return out.toString();
    }

    private static void append(StringBuilder out, Object value) {
        if (value == null) out.append("null");
        else if (value instanceof String text) {
            out.append('"');
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                switch (c) {
                    case '"' -> out.append("\\\"");
                    case '\\' -> out.append("\\\\");
                    case '\n' -> out.append("\\n");
                    case '\r' -> out.append("\\r");
                    case '\t' -> out.append("\\t");
                    default -> {
                        if (c < 0x20 || Character.isSurrogate(c)) out.append(String.format("\\u%04x", (int) c));
                        else out.append(c);
                    }
                }
            }
            out.append('"');
        } else if (value instanceof Number number) {
            out.append(Double.isFinite(number.doubleValue()) ? number.toString() : "null");
        } else if (value instanceof Boolean) out.append(value);
        else if (value instanceof Map<?, ?> map) {
            out.append('{');
            boolean comma = false;
            for (var entry : map.entrySet()) {
                if (comma) out.append(',');
                append(out, entry.getKey().toString());
                out.append(':');
                append(out, entry.getValue());
                comma = true;
            }
            out.append('}');
        } else if (value instanceof Iterable<?> list) {
            out.append('[');
            boolean comma = false;
            for (Object item : list) {
                if (comma) out.append(',');
                append(out, item);
                comma = true;
            }
            out.append(']');
        } else if (value.getClass().isArray()) {
            out.append('[');
            for (int i = 0; i < Array.getLength(value); i++) {
                if (i > 0) out.append(',');
                append(out, Array.get(value, i));
            }
            out.append(']');
        } else throw new IllegalArgumentException("Unsupported JSON value: " + value.getClass());
    }
}
