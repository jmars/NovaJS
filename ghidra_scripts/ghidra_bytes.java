import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

public class ghidra_bytes extends GhidraScript {
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        for (String a : getScriptArgs()) {
            Address at = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress(a.replaceFirst("^0x", ""));
            int len = 32;
            byte[] buf = new byte[len];
            mem.getBytes(at, buf);
            StringBuilder hex = new StringBuilder();
            for (byte b : buf) hex.append(String.format("%02x", b));
            // little-endian doubles
            StringBuilder dbl = new StringBuilder();
            for (int i = 0; i + 8 <= len; i += 8) {
                long v = 0;
                for (int j = 7; j >= 0; j--) {
                    v = (v << 8) | (buf[i + j] & 0xff);
                }
                double d = Double.longBitsToDouble(v);
                dbl.append(" dbl@+").append(i).append("=").append(d);
            }
            // little-endian floats
            StringBuilder flt = new StringBuilder();
            for (int i = 0; i + 4 <= len; i += 4) {
                int v = 0;
                for (int j = 3; j >= 0; j--) {
                    v = (v << 8) | (buf[i + j] & 0xff);
                }
                flt.append(" flt@+").append(i).append("=").append(Float.intBitsToFloat(v));
            }
            println(a + " [" + hex + "]" + dbl.toString() + " |" + flt.toString());
        }
    }
}
