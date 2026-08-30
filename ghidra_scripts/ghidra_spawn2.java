import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.util.task.ConsoleTaskMonitor;
import ghidra.program.model.symbol.Reference;

public class ghidra_spawn2 extends GhidraScript {
    public void run() throws Exception {
        String mode = getScriptArgs()[0];
        FunctionManager fm = currentProgram.getFunctionManager();
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);
        if (mode.equals("decomp")) {
            for (int i = 1; i < getScriptArgs().length; i++) {
                Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace()
                    .getAddress(getScriptArgs()[i]);
                Function f = fm.getFunctionContaining(addr);
                if (f == null) { println("NO FN@" + getScriptArgs()[i]); continue; }
                println("=== FN " + f.getName() + " @ " + f.getEntryPoint() + " ===");
                DecompileResults res = decomp.decompileFunction(f, 120, new ConsoleTaskMonitor());
                if (res.decompileCompleted()) println(res.getDecompiledFunction().getC());
                else println("decompile failed");
            }
        } else if (mode.equals("xref")) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress(getScriptArgs()[1]);
            Reference[] refs = getReferencesTo(addr);
            for (Reference r : refs) {
                println("ref from " + r.getFromAddress() + " type " + r.getReferenceType());
            }
        } else if (mode.equals("findbytes")) {
            // args: hex pattern (no spaces)
            Memory mem = currentProgram.getMemory();
            byte[] pat = new byte[(getScriptArgs()[1].length()) / 2];
            String hex = getScriptArgs()[1];
            for (int i = 0; i < pat.length; i++) {
                pat[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
            }
            MemoryBlock[] blocks = currentProgram.getMemory().getBlocks();
            for (MemoryBlock b : blocks) {
                if (!b.isInitialized()) continue;
                byte[] buf = new byte[(int) b.getSize()];
                mem.getBytes(b.getStart(), buf);
                for (int i = 0; i + pat.length <= buf.length; i++) {
                    boolean ok = true;
                    for (int j = 0; j < pat.length; j++) {
                        if (buf[i + j] != pat[j]) { ok = false; break; }
                    }
                    if (ok) println("HIT " + b.getName() + " " + b.getStart().add(i));
                }
            }
        }
    }
}
