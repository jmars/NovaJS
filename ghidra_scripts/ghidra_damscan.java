import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;

import java.util.*;

public class ghidra_damscan extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        for (MemoryBlock b : currentProgram.getMemory().getBlocks())
            println("BLOCK " + b.getName() + " " + b.getStart() + " - " + b.getEnd() + " init=" + b.isInitialized());
        for (String a : args) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseLong(a, 16));
            try {
                byte[] b = new byte[16];
                currentProgram.getMemory().getBytes(addr, b);
                StringBuilder sb = new StringBuilder();
                for (byte x : b) sb.append(String.format("%02x ", x));
                println("=== bytes at " + a + ": " + sb);
            } catch (Exception e) {
                println("=== bytes at " + a + ": unreadable (" + e.getMessage() + ")");
            }
            Reference[] refs = getReferencesTo(addr);
            println("=== refs to " + a + ": " + refs.length);
            Set<Function> fns = new LinkedHashSet<>();
            for (Reference r : refs) {
                Function f = getFunctionContaining(r.getFromAddress());
                if (f != null) fns.add(f);
                else println("  ref from " + r.getFromAddress() + " (no fn) type=" + r.getReferenceType());
            }
            println("=== functions referencing " + a + ": " + fns.size());
            DecompInterface di = new DecompInterface();
            di.openProgram(currentProgram);
            for (Function f : fns) {
                DecompileResults res = di.decompileFunction(f, 45, monitor);
                if (res == null || !res.decompileCompleted()) continue;
                String code = res.getDecompiledFunction().getC();
                boolean h50 = code.contains("+ 0x50)");
                boolean h54 = code.contains("+ 0x54)");
                boolean h58 = code.contains("+ 0x58)");
                if ((h50 && h54) || (h50 && h58)) {
                    println("---- CANDIDATE " + f.getName() + " @ " + f.getEntryPoint() +
                        " (0x50=" + h50 + " 0x54=" + h54 + " 0x58=" + h58 + ")");
                    for (String line : code.split("\n")) {
                        String t = line.trim();
                        if (t.contains("0x50)") || t.contains("0x54)") || t.contains("0x58)"))
                            println("    " + t);
                    }
                }
            }
            di.dispose();
        }
    }
}
