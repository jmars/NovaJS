import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;

public class ghidra_spobflags extends GhidraScript {
    public void run() throws Exception {
        long[] targets = {0x2, 0x4, 0x8, 0x10, 0x20, 0x40, 0x80};
        InstructionIterator ii = currentProgram.getListing().getInstructions(true);
        while (ii.hasNext()) {
            Instruction i = ii.next();
            for (int op = 0; op < i.getNumOperands(); op++) {
                for (Object o : i.getOpObjects(op)) {
                    if (o instanceof Scalar) {
                        long v = ((Scalar) o).getValue() & 0xffffffffL;
                        for (long t : targets) {
                            if (v == t) {
                                String a = i.getAddress().toString();
                                if (a.compareTo("0048e000") > 0 && a.compareTo("00494000") < 0) {
                                    println("@" + a + " " + t + " : " + i);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
