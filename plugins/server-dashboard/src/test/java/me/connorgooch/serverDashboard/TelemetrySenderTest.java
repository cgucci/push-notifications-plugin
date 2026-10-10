package me.connorgooch.serverDashboard;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class TelemetrySenderTest {
    private static final String SECRET = "test-secret-with-at-least-32-characters";

    @Test void rejectsNonLoopbackAndAmbiguousEndpoints() {
        for (String endpoint : List.of("http://example.com:8788/ingest", "http://localhost:8788/ingest",
            "https://127.0.0.1:8788/ingest", "http://127.0.0.1/ingest", "http://user@127.0.0.1:8788/ingest",
            "http://127.0.0.1:8788/ingest?secret=x", "http://127.0.0.1:8788/ingest#fragment")) {
            assertThrows(IllegalArgumentException.class, () -> TelemetrySender.validateEndpoint(URI.create(endpoint)));
        }
        assertDoesNotThrow(() -> TelemetrySender.validateEndpoint(URI.create("http://[::1]:8788/ingest")));
    }

    @Test void retriesWithIdenticalBodyIdAndAuthentication() throws Exception {
        var bodies = new CopyOnWriteArrayList<String>();
        var ids = new CopyOnWriteArrayList<String>();
        var auth = new CopyOnWriteArrayList<String>();
        var complete = new CountDownLatch(3);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/ingest", exchange -> {
            bodies.add(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            ids.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
            auth.add(exchange.getRequestHeaders().getFirst("Authorization"));
            exchange.sendResponseHeaders(bodies.size() < 3 ? 503 : 204, -1);
            exchange.close();
            complete.countDown();
        });
        server.start();
        var preparations = new AtomicInteger();
        try (var sender = sender(server)) {
            sender.offer("stable-id", () -> { preparations.incrementAndGet(); return "{\"id\":\"stable-id\"}"; }, false);
            assertTrue(complete.await(8, TimeUnit.SECONDS));
            assertEquals(1, preparations.get());
            assertEquals(List.of("stable-id", "stable-id", "stable-id"), ids);
            assertEquals(1, bodies.stream().distinct().count());
            assertTrue(auth.stream().allMatch(value -> ("Bearer " + SECRET).equals(value)));
        } finally { server.stop(0); }
    }

    @Test void permanentErrorsAndRedirectsAreNotRetried() throws Exception {
        for (int status : List.of(401, 302)) {
            var received = new CountDownLatch(1);
            var rejected = new CountDownLatch(1);
            var count = new AtomicInteger();
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/ingest", exchange -> {
                count.incrementAndGet();
                exchange.getRequestBody().readAllBytes();
                exchange.getResponseHeaders().set("Location", "http://example.com/");
                exchange.sendResponseHeaders(status, -1);
                exchange.close();
                received.countDown();
            });
            server.start();
            try (var sender = new TelemetrySender(endpoint(server), SECRET, warning -> rejected.countDown())) {
                sender.offer("id", () -> "{}", false);
                assertTrue(received.await(3, TimeUnit.SECONDS));
                assertTrue(rejected.await(3, TimeUnit.SECONDS));
                assertEquals(1, count.get());
            } finally { server.stop(0); }
        }
    }

    @Test void retryLimitIsThreeAttempts() throws Exception {
        var count = new AtomicInteger();
        var failed = new CountDownLatch(1);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/ingest", exchange -> {
            count.incrementAndGet();
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        server.start();
        try (var sender = new TelemetrySender(endpoint(server), SECRET, warning -> failed.countDown())) {
            sender.offer("id", () -> "{}", false);
            assertTrue(failed.await(8, TimeUnit.SECONDS));
            assertEquals(3, count.get());
        } finally { server.stop(0); }
    }

    @Test void queueIsBoundedSnapshotsCoalesceAndShutdownDoesNotBlock() throws Exception {
        var preparing = new CountDownLatch(1);
        var unblock = new CountDownLatch(1);
        try (var sender = new TelemetrySender(URI.create("http://127.0.0.1:1/ingest"), SECRET, ignored -> {})) {
            sender.offer("blocking", () -> {
                preparing.countDown();
                try { unblock.await(); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                return "{}";
            }, false);
            assertTrue(preparing.await(3, TimeUnit.SECONDS));
            for (int i = 0; i < 1000; i++) {
                sender.offer("event-" + i, () -> "{}", false);
                sender.offer("snapshot-" + i, () -> "{}", true);
            }
            assertEquals(TelemetrySender.EVENT_CAPACITY + 1, sender.queuedMessages());
            long start = System.nanoTime();
            sender.close();
            assertTrue(System.nanoTime() - start < TimeUnit.MILLISECONDS.toNanos(100));
            assertEquals(0, sender.queuedMessages());
        } finally { unblock.countDown(); }
    }

    @Test void unavailableDiskDoesNotLoseOtherMetrics() {
        var metrics = new ResourceMetrics(java.nio.file.Path.of("/nonexistent-dashboard-test-path")).sample();
        assertNull(metrics.get("diskAvailableBytes"));
        assertTrue((long) metrics.get("jvmHeapUsedBytes") > 0);
        assertNotNull(metrics.get("vmTotalRamBytes"));
    }

    @Test void jsonEscapesControlCharactersAndUnknownNumbers() {
        var values = new java.util.LinkedHashMap<String, Object>();
        values.put("text", "a\n\"\\");
        values.put("nan", Double.NaN);
        assertEquals("{\"text\":\"a\\n\\\"\\\\\",\"nan\":null}",
            Json.encode(values));
    }

    private static URI endpoint(HttpServer server) { return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/ingest"); }
    private static TelemetrySender sender(HttpServer server) { return new TelemetrySender(endpoint(server), SECRET, ignored -> {}); }
}
