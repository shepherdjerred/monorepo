import java.lang.classfile.ClassFile;
import java.lang.classfile.ClassTransform;
import java.lang.classfile.CodeBuilder;
import java.lang.classfile.CodeElement;
import java.lang.classfile.CodeTransform;
import java.lang.constant.ClassDesc;
import java.lang.constant.ConstantDescs;
import java.lang.constant.MethodTypeDesc;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.JarFile;

/** Flush vanilla 1.17.1's pending chunk writes before IOWorker.close marks it closed. */
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
        }
    }
}
