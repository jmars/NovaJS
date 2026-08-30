import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;

import java.util.*;

public class ghidra_hl extends GhidraScript {
    public void run() throws Exception {
        for (String a : getScriptArgs()) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseLong(a, 16));
            Reference[] refs = getReferencesTo(addr);
            Set<Function> fns = new LinkedHashSet<>();
            for (Reference r : refs) {
                if (!r.getReferenceType().isCall()) continue;
                Function f = getFunctionContaining(r.getFromAddress());
                if (f != null) fns.add(f);
            }
            println("=== " + a + " callers: " + fns.size());
            for (Function f : fns) println("   " + f.getEntryPoint() + " " + f.getName());
        }
    }
}
