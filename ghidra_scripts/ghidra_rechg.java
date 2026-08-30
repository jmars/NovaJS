import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Program;

import java.util.*;
import java.util.regex.*;

public class ghidra_rechg extends GhidraScript {
    public void run() throws Exception {
        Program p = currentProgram;
        Pattern pSh = Pattern.compile("DAT_005912a4 \\+ 2 \\+");
        Pattern pAr = Pattern.compile("DAT_005912a4 \\+ 0xe \\+");
        Pattern pFld = Pattern.compile("\\+ 0x5[048]\\)");
        DecompInterface di = new DecompInterface();
        di.openProgram(p);
        FunctionIterator it = p.getFunctionManager().getFunctions(true);
        int n = 0;
        while (it.hasNext()) {
            Function f = it.next();
            DecompileResults res = di.decompileFunction(f, 30, monitor);
            if (res == null || !res.decompileCompleted()) continue;
            String code = res.getDecompiledFunction().getC();
            boolean sh = pSh.matcher(code).find();
            boolean ar = pAr.matcher(code).find();
            if (!sh && !ar) continue;
            if (!pFld.matcher(code).find()) continue;
            n++;
            println("---- RECHG-CAND " + f.getName() + " @ " + f.getEntryPoint() + " maxShield=" + sh + " maxArmor=" + ar);
            int shown = 0;
            for (String line : code.split("\n")) {
                String t = line.trim();
                if ((t.contains("DAT_005912a4 + 2 +") || t.contains("DAT_005912a4 + 0xe +") ||
                     (t.contains("0x50)") || t.contains("0x54)") || t.contains("0x58)")))) {
                    println("    " + t);
                    if (++shown > 20) { println("    ..."); break; }
                }
            }
        }
        println("total: " + n);
        di.dispose();
    }
}
