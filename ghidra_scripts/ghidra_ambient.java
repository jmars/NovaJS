import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;

public class ghidra_ambient extends GhidraScript {
    @Override
    public void run() throws Exception {
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        for (String arg : getScriptArgs()) {
            Address a = currentProgram.getAddressFactory().getAddress(arg);
            Function f = getFunctionContaining(a);
            if (f == null) { println("no function at " + arg); continue; }
            DecompileResults r = di.decompileFunction(f, 60, monitor);
            println("=== " + f.getName() + " @ " + f.getEntryPoint());
            println(r.getDecompiledFunction().getC());
        }
    }
}
