import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;

// Scan every function that references the given global base for instructions
// using ANY of the given field displacements; print reads and writes.
public class ghidra_fieldscan extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Address base = currentProgram.getAddressFactory().getDefaultAddressSpace()
            .getAddress(args[0].replaceFirst("^0x", ""));
        FunctionManager fm = currentProgram.getFunctionManager();

        AddressSet fns = new AddressSet();
        ReferenceIterator rit = currentProgram.getReferenceManager().getReferencesTo(base);
        while (rit.hasNext()) {
            Reference r = rit.next();
            Function f = fm.getFunctionContaining(r.getFromAddress());
            if (f != null) fns.add(f.getEntryPoint());
        }
        println("functions referencing base " + base + ": " + fns.getNumAddresses());

        for (int k = 1; k < args.length; k++) {
            long fieldOff = Long.decode(args[k]);
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
                    String rw = i.getOperandRefType(op).isWrite() ? "WRITE" : "read ";
                    println(rw + " +" + Long.toHexString(fieldOff) + " " + i.getAddress() + " : "
                        + i + "  [FN " + f.getName() + "@" + f.getEntryPoint() + "]");
                }
            }
        }
    }
}
