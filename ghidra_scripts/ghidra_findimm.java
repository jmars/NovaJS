import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.scalar.Scalar;

public class ghidra_findimm extends GhidraScript {
    @Override
    public void run() throws Exception {
        // args: comma-separated hex immediates
        String[] arglist = getScriptArgs()[0].split(",");
        long[] targets = new long[arglist.length];
        for (int i = 0; i < arglist.length; i++) targets[i] = Long.parseLong(arglist[i].trim(), 16);
        FunctionIterator funcs = currentProgram.getFunctionManager().getFunctions(true);
        InstructionIterator ins = currentProgram.getListing().getInstructions(true);
        Function cur = null;
        for (Instruction i : ins) {
            Address a = i.getAddress();
            if (cur == null || !cur.getBody().contains(a)) {
                cur = getFunctionContaining(a);
            }
            if (cur == null) continue;
            for (int op = 0; op < i.getNumOperands(); op++) {
                Scalar s = i.getScalar(op);
                if (s == null) continue;
                long v = s.getUnsignedValue();
                for (long t : targets) {
                    if (v == t) {
                        println(Long.toHexString(t) + " @ " + a + " in " + cur.getName() + " @ " + cur.getEntryPoint() + " | " + i.toString());
                        break;
                    }
                }
            }
        }
    }
}
