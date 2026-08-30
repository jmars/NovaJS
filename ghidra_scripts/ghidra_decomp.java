import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.address.Address;
import ghidra.util.task.ConsoleTaskMonitor;

public class ghidra_decomp extends GhidraScript {
    public void run() throws Exception {
        String[] targets = getScriptArgs();
        FunctionManager fm = currentProgram.getFunctionManager();
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);
        for (String a : targets) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(a);
            Function f = fm.getFunctionContaining(addr);
            if (f == null) { println("NO FN@"+a); continue; }
            println("=== FN " + f.getName() + " @ " + f.getEntryPoint() + " ===");
            DecompileResults res = decomp.decompileFunction(f, 60, new ConsoleTaskMonitor());
            if (res.decompileCompleted()) println(res.getDecompiledFunction().getC());
            else println("decompile failed");
        }
    }
}
