import java.lang.classfile.ClassFile;
import java.lang.classfile.ClassTransform;
import java.lang.classfile.CodeBuilder;
import java.lang.classfile.CodeElement;
import java.lang.classfile.CodeTransform;
import java.lang.classfile.instruction.InvokeInstruction;
import java.lang.constant.ClassDesc;
import java.lang.constant.ConstantDescs;
import java.lang.constant.MethodTypeDesc;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.JarFile;

/** Flush vanilla's pending writes and exit after offline conversion, before world startup. */
public final class PatchUpgrader {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            throw new IllegalArgumentException("Expected verified server JAR and output directory");
        }
        var classFile = ClassFile.of();
        try (var jar = new JarFile(args[0])) {
            var model = classFile.parse(jar.getInputStream(jar.getJarEntry("cnm.class")).readAllBytes());
            if (!model.thisClass().asInternalName().equals("cnm")
                || model.methods().stream().filter(m -> m.methodName().equalsString("close")
                    && m.methodType().equalsString("()V")).count() != 1
                || model.methods().stream().filter(m -> m.methodName().equalsString("a")
                    && m.methodType().equalsString("(Z)Ljava/util/concurrent/CompletableFuture;")).count() != 1) {
                throw new IllegalStateException("Unexpected vanilla IOWorker contract");
            }
            var worker = ClassDesc.of("cnm");
            var future = ClassDesc.of("java.util.concurrent.CompletableFuture");
            var flag = ClassDesc.of("java.util.concurrent.atomic.AtomicBoolean");
            var patched = classFile.transformClass(model, ClassTransform.transformingMethodBodies(
                m -> m.methodName().equalsString("close") && m.methodType().equalsString("()V"),
                new CodeTransform() {
                    @Override
                    public void atStart(CodeBuilder code) {
                        var original = code.newLabel();
                        // Preserve repeated-close behavior. Flush while the queue still accepts writes.
                        code.aload(0).getfield(worker, "b", flag)
                            .invokevirtual(flag, "get", MethodTypeDesc.of(ConstantDescs.CD_boolean))
                            .ifne(original)
                            .aload(0).iconst_1()
                            .invokevirtual(worker, "a", MethodTypeDesc.of(future, ConstantDescs.CD_boolean))
                            .invokevirtual(future, "join", MethodTypeDesc.of(ConstantDescs.CD_Object))
                            .pop().labelBinding(original);
                    }

                    @Override
                    public void accept(CodeBuilder code, CodeElement element) {
                        code.with(element);
                    }
                }));
            var failures = classFile.verify(patched);
            if (!failures.isEmpty()) {
                throw new IllegalStateException("Patched bytecode failed verification: " + failures);
            }
            Files.createDirectories(Path.of(args[1]));
            Files.write(Path.of(args[1], "cnm.class"), patched);
            var main = classFile.parse(jar.getInputStream(jar.getJarEntry("net/minecraft/server/Main.class")).readAllBytes());
            var calls = main.methods().stream().filter(m -> m.methodName().equalsString("main"))
                .flatMap(m -> m.code().orElseThrow().elementList().stream())
                .filter(PatchUpgrader::isUpgradeCall).count();
            if (calls != 1) {
                throw new IllegalStateException("Unexpected vanilla offline-upgrade call site");
            }
            var exitAfterUpgrade = classFile.transformClass(main, ClassTransform.transformingMethodBodies(
                m -> m.methodName().equalsString("main"), (code, element) -> {
                    code.with(element);
                    if (isUpgradeCall(element)) {
                        // The vanilla helper waits until all chunk stores are closed and
                        // persisted. Do not boot a server that could regenerate old chunks
                        // whose population or lighting flags are incomplete.
                        var system = ClassDesc.of("java.lang.System");
                        var printStream = ClassDesc.of("java.io.PrintStream");
                        code.getstatic(system, "out", printStream)
                            .ldc("STORM_ARCHIVE_CONVERSION_COMPLETE")
                            .invokevirtual(printStream, "println", MethodTypeDesc.of(ConstantDescs.CD_void, ConstantDescs.CD_String))
                            .iconst_0().invokestatic(system, "exit", MethodTypeDesc.of(ConstantDescs.CD_void, ConstantDescs.CD_int));
                    }
                }));
            if (!classFile.verify(exitAfterUpgrade).isEmpty()) {
                throw new IllegalStateException("Patched main bytecode failed verification");
            }
            var output = Path.of(args[1], "net/minecraft/server/Main.class");
            Files.createDirectories(output.getParent());
            Files.write(output, exitAfterUpgrade);
        }
    }

    private static boolean isUpgradeCall(CodeElement element) {
        return element instanceof InvokeInstruction invoke
            && invoke.owner().asInternalName().equals("net/minecraft/server/Main")
            && invoke.name().equalsString("a")
            && invoke.type().equalsString("(Ldib$a;Lcom/mojang/datafixers/DataFixer;ZLjava/util/function/BooleanSupplier;Lcom/google/common/collect/ImmutableSet;)V");
    }
}
