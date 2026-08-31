import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.Memory;
public class ghidra_mem extends GhidraScript {
    public void run() throws Exception {
        Memory m = currentProgram.getMemory();
        for (String arg : getScriptArgs()) {
            String[] parts = arg.split(":");
            Address a = currentProgram.getAddressFactory().getAddress(parts[0]);
            int n = parts.length > 1 ? Integer.decode(parts[1]) : 16;
            byte[] b = new byte[n];
            m.getBytes(a, b);
            StringBuilder sb = new StringBuilder(a + ": ");
            for (byte x : b) sb.append(String.format("%02x ", x));
            println(sb.toString());
        }
    }
}
