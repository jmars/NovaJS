import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.address.Address;

public class ghidra_systfind extends GhidraScript {
    public void run() throws Exception {
        // find functions that read offset 36 (0x24, spobs) AND offset 8 (govt)
        InstructionIterator ii = currentProgram.getListing().getInstructions(true);
        FunctionManager fm = currentProgram.getFunctionManager();
        java.util.HashMap<Function,java.util.Set<Long>> reads = new java.util.HashMap<>();
        while (ii.hasNext()) {
            Instruction i = ii.next();
            Function f = fm.getFunctionContaining(i.getAddress());
            if (f == null) continue;
            for (int op = 0; op < i.getNumOperands(); op++) {
                for (Object o : i.getOpObjects(op)) {
                    if (o instanceof Scalar) {
                        long v = ((Scalar)o).getValue();
                        if ((v == 8) || (v == 36) || (v == 0) || (v == 4)) {
                            reads.computeIfAbsent(f, k -> new java.util.LinkedHashSet<>()).add(v);
                        }
                    }
                }
            }
        }
        for (java.util.Map.Entry<Function,java.util.Set<Long>> e : reads.entrySet()) {
            if (e.getValue().containsAll(java.util.Arrays.asList(8L,36L))) {
                println("FN " + e.getKey().getName() + " @ " + e.getKey().getEntryPoint() + " reads " + e.getValue());
            }
        }
    }
}
