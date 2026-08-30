import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;

public class ghidra_ostype extends GhidraScript {
    static String hex(long v) {
        // little-endian 4 bytes of v
        return String.format("%02x %02x %02x %02x",
            (v) & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    }
    public void run() throws Exception {
        long[] vals = { 0x74EB6C66L /*flët*/, 0x7372EB70L /*përs*/, 0x6564FC64L /*düde*/ };
        for (long v : vals) {
            String pat = hex(v);
            println("=== searching " + pat + " ===");
            Address a = currentProgram.getMinAddress();
            while (a != null) {
                a = findBytes(a, pat);
                if (a == null) break;
                println("  " + a);
                a = a.add(1);
            }
        }
    }
}
