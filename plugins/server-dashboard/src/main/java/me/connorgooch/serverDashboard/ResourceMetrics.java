package me.connorgooch.serverDashboard;

import com.sun.management.OperatingSystemMXBean;
import java.lang.management.ManagementFactory;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/** All OS and filesystem work happens on the delivery worker, never the game thread. */
final class ResourceMetrics {
    private final Path diskPath;

    ResourceMetrics(Path diskPath) { this.diskPath = diskPath; }

    Map<String, Object> sample() {
        var result = new LinkedHashMap<String, Object>();
        result.put("capturedAt", Instant.now().toString());
        result.put("scope", "server-os");
        result.put("os", System.getProperty("os.name"));
        result.put("availableProcessors", Runtime.getRuntime().availableProcessors());
        var heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
        result.put("jvmHeapUsedBytes", heap.getUsed());
        result.put("jvmHeapMaxBytes", available(heap.getMax()));
        result.put("jvmNonHeapUsedBytes", ManagementFactory.getMemoryMXBean().getNonHeapMemoryUsage().getUsed());
        result.put("processResidentMemoryBytes", residentMemory());
        var bean = ManagementFactory.getOperatingSystemMXBean();
        if (bean instanceof OperatingSystemMXBean os) {
            result.put("processCpuRatio", ratio(os.getProcessCpuLoad()));
            result.put("vmCpuRatio", ratio(os.getCpuLoad()));
            result.put("vmTotalRamBytes", available(os.getTotalMemorySize()));
            result.put("vmFreeRamBytes", available(os.getFreeMemorySize()));
        } else {
            result.put("processCpuRatio", null);
            result.put("vmCpuRatio", null);
            result.put("vmTotalRamBytes", null);
            result.put("vmFreeRamBytes", null);
        }
        try {
            var store = Files.getFileStore(diskPath);
            result.put("diskTotalBytes", store.getTotalSpace());
            result.put("diskAvailableBytes", store.getUsableSpace());
        } catch (Exception ignored) {
            result.put("diskTotalBytes", null);
            result.put("diskAvailableBytes", null);
        }
        return result;
    }

    private static Long available(long value) { return value < 0 ? null : value; }
    private static Double ratio(double value) { return value < 0 || !Double.isFinite(value) ? null : value; }

    private static Long residentMemory() {
        if (!System.getProperty("os.name").equalsIgnoreCase("Linux")) return null;
        try (var lines = Files.lines(Path.of("/proc/self/status"))) {
            return lines.filter(line -> line.startsWith("VmRSS:"))
                .map(line -> Long.parseLong(line.trim().split("\\s+")[1]) * 1024)
                .findFirst().orElse(null);
        } catch (Exception ignored) { return null; }
    }
}
