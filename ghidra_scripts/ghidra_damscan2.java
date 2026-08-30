import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;

import java.util.*;
import java.util.regex.*;

public class ghidra_damscan2 extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseLong(args[0], 16));
        Reference[] refs = getReferencesTo(addr);
        Set<Function> fns = new LinkedHashSet<>();
        for (Reference r : refs) {
            Function f = getFunctionContaining(r.getFromAddress());
            if (f != null) fns.add(f);
        }
        println("functions referencing " + args[0] + ": " + fns.size());
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        Pattern floatHealth = Pattern.compile("\\(float \\*\\)[^;]*\\+ 0x5[048]\\)");
        Pattern stride = Pattern.compile("0xc948");
        int n = 0;
        for (Function f : fns) {
            DecompileResults res = di.decompileFunction(f, 45, monitor);
            if (res == null || !res.decompileCompleted()) continue;
            String code = res.getDecompiledFunction().getC();
            Matcher m = floatHealth.matcher(code);
            boolean fh = m.find();
            boolean st = stride.matcher(code).find();
            if (!fh && !st) continue;
            n++;
            println("---- HIT " + f.getName() + " @ " + f.getEntryPoint() + " floatHealth=" + fh + " stride=" + st);
            int shown = 0;
            for (String line : code.split("\n")) {
                String t = line.trim();
                if (t.contains("0xc948") || (t.contains("0x50)") || t.contains("0x54)") || t.contains("0x58)")) && t.contains("float")) {
                    println("    " + t);
                    if (++shown > 25) { println("    ..."); break; }
                }
            }
        }
        println("total hits: " + n);
        di.dispose();
    }
}
