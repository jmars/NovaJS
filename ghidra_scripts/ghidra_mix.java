import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;

import java.util.*;

public class ghidra_mix extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        // first arg: address whose CALLERS to list
        Address ca = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseLong(args[0], 16));
        println("=== callers of " + args[0] + " ===");
        for (Reference r : getReferencesTo(ca)) {
            if (!r.getReferenceType().isCall()) continue;
            Function f = getFunctionContaining(r.getFromAddress());
            println("   " + r.getFromAddress() + " in " + (f != null ? f.getName() + " @ " + f.getEntryPoint() : "?"));
        }
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        for (int i = 1; i < args.length; i++) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseLong(args[i], 16));
            Function f = getFunctionContaining(a);
            if (f == null) { println("=== no fn at " + args[i]); continue; }
            DecompileResults res = di.decompileFunction(f, 60, monitor);
            println("===== DECOMP " + f.getName() + " @ " + f.getEntryPoint() + " =====");
            if (res != null && res.decompileCompleted())
                println(res.getDecompiledFunction().getC());
            else println("   <decompile failed>");
        }
        di.dispose();
    }
}
