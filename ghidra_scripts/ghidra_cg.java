import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import java.util.*;

public class ghidra_cg extends GhidraScript {
    @Override
    public void run() throws Exception {
        FunctionManager fm = currentProgram.getFunctionManager();
        for (String arg : getScriptArgs()) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress(arg.replaceFirst("^0x", ""));
            Function f = getFunctionContaining(a);
            if (f == null) { println("### NO FN " + arg); continue; }
            println("### FN " + f.getName() + " @ " + f.getEntryPoint()
                + " body=" + f.getBody().getNumAddresses());
            // callees
            TreeSet<Address> calls = new TreeSet<>();
            InstructionIterator ii = currentProgram.getListing().getInstructions(f.getBody(), true);
            while (ii.hasNext()) {
                Instruction i = ii.next();
                for (Reference r : i.getReferencesFrom()) {
                    if (r.getReferenceType().isCall()) calls.add(r.getToAddress());
                }
            }
            StringBuilder sb = new StringBuilder("  CALLS:");
            for (Address c : calls) {
                Function t = fm.getFunctionAt(c);
                sb.append(" ").append(c).append(t != null ? "(" + t.getName() + ")" : "(?)");
            }
            println(sb.toString());
            // callers
            ReferenceIterator ri = currentProgram.getReferenceManager().getReferenceIterator(f.getEntryPoint());
            StringBuilder cb = new StringBuilder("  CALLERS:");
            int n = 0;
            while (ri.hasNext()) {
                Reference r = ri.next();
                if (r.getReferenceType().isCall()) {
                    Function caller = getFunctionContaining(r.getFromAddress());
                    cb.append(" ").append(caller != null ? caller.getName() + "@" + r.getFromAddress() : r.getFromAddress());
                    if (++n > 40) { cb.append(" ..."); break; }
                }
            }
            println(cb.toString());
        }
    }
}
