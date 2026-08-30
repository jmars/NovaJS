import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.listing.Function;

public class ghidra_f32 extends GhidraScript {
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        for (String a : getScriptArgs()) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseLong(a, 16));
            try {
                byte[] b = new byte[8];
                mem.getBytes(addr, b);
                int i = ((b[0] & 0xff)) | ((b[1] & 0xff) << 8) | ((b[2] & 0xff) << 16) | ((b[3] & 0xff) << 24);
                float f = Float.intBitsToFloat(i);
                int j = ((b[4] & 0xff)) | ((b[5] & 0xff) << 8) | ((b[6] & 0xff) << 16) | ((b[7] & 0xff) << 24);
                float g = Float.intBitsToFloat(j);
                println("DAT_" + a + " = 0x" + Integer.toHexString(i) + " float=" + f +
                    "   | next: 0x" + Integer.toHexString(j) + " float=" + g);
            } catch (Exception e) {
                println("DAT_" + a + " unreadable");
            }
        }
    }
}
