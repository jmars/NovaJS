import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.scalar.Scalar;

public class ghidra_systw extends GhidraScript {
    public void run() throws Exception {
        // functions that WRITE to DAT_005912b0+idx*0x1fc (system table), i.e. the sÿst loader
        Address base = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("005912b0");
        FunctionManager fm = currentProgram.getFunctionManager();
        InstructionIterator ii = currentProgram.getListing().getInstructions(true);
        java.util.Set<Function> fns = new java.util.LinkedHashSet<>();
        while (ii.hasNext()) {
            Instruction i = ii.next();
            Function f = fm.getFunctionContaining(i.getAddress());
            if (f == null) continue;
            for (int op = 0; op < i.getNumOperands(); op++) {
                Object[] objs = i.getOpObjects(op);
                boolean ref = false;
                for (Object o : objs) {
                    if (o instanceof Address && ((Address)o).getOffset() == 0x5912b0) ref = true;
                }
                if (ref && i.getOperandRefType(op).isWrite()) fns.add(f);
            }
        }
        for (Function f : fns) println("WRITES sÿst table: " + f.getName() + " @ " + f.getEntryPoint());
        println("count " + fns.size());
    }
}
