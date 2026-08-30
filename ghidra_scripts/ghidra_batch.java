import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import ghidra.util.task.ConsoleTaskMonitor;

public class ghidra_batch extends GhidraScript {
    @Override
    public void run() throws Exception {
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        for (String arg : getScriptArgs()) {
            Address a = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress(arg.replaceFirst("^0x", ""));
            Function f = getFunctionContaining(a);
            if (f == null) {
                println("### NO FN containing " + arg);
                // print 8 instructions around
                Address s = a.subtract(16);
                InstructionIterator ii = currentProgram.getListing().getInstructions(s, true);
                int n = 0;
                while (ii.hasNext() && n < 12) { println("  " + ii.next()); n++; }
                continue;
            }
            println("### FN " + f.getName() + " @ " + f.getEntryPoint() + " (arg " + arg + ")");
            DecompileResults r = di.decompileFunction(f, 90, new ConsoleTaskMonitor());
            if (r.decompileCompleted()) println(r.getDecompiledFunction().getC());
            else println("decompile failed: " + r.getErrorMessage());
        }
    }
}
