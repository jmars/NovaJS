import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;
import java.util.*;

public class ghidra_fw2 extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        FunctionManager fm = currentProgram.getFunctionManager();
        for (int a = 0; a + 1 < args.length; a += 2) {
            Address base = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress(args[a].replaceFirst("^0x", ""));
            int fieldOff = Integer.decode(args[a + 1]);
            AddressSet fns = new AddressSet();
            ReferenceIterator rit = currentProgram.getReferenceManager().getReferencesTo(base);
            while (rit.hasNext()) {
                Reference r = rit.next();
                Function f = fm.getFunctionContaining(r.getFromAddress());
                if (f != null) fns.add(f.getEntryPoint());
            }
            println("=== [" + args[a] + " + 0x" + Integer.toHexString(fieldOff) + "] fns=" + fns.getNumAddresses());
            InstructionIterator ii = currentProgram.getListing().getInstructions(true);
            while (ii.hasNext()) {
                Instruction i = ii.next();
                Function f = fm.getFunctionContaining(i.getAddress());
                if (f == null || !fns.contains(f.getEntryPoint())) continue;
                int n = i.getNumOperands();
                for (int op = 0; op < n; op++) {
                    Object[] ops = i.getOpObjects(op);
                    if (ops == null) continue;
                    boolean hasDisp = false;
                    for (Object o : ops) {
                        if (o instanceof Scalar && ((Scalar) o).getValue() == fieldOff) hasDisp = true;
                    }
                    if (!hasDisp) continue;
                    if (i.getOperandRefType(op).isWrite()) {
                        println("  WRITE " + i.getAddress() + " : " + i + "  [FN " + f.getName() + "@"
                            + f.getEntryPoint() + "]");
                        break;
                    }
                }
            }
        }
    }
}
