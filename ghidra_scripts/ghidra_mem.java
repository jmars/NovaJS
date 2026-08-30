import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;

public class ghidra_mem extends GhidraScript {
    public void run() throws Exception {
        Memory mem = currentProgram.getMemory();
        for (String a : getScriptArgs()) {
            Address at = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress(a.replaceFirst("^0x", ""));
            byte[] buf = new byte[64];
            mem.getBytes(at, buf);
            StringBuilder sb = new StringBuilder(a + ": ");
            for (byte b : buf) {
                if (b == 0) break;
                sb.append((char)(b & 0xff));
            }
            println(sb.toString());
        }
    }
}
