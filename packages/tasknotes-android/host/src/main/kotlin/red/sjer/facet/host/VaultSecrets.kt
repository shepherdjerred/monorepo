package red.sjer.facet.host

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only ciphertext enters private preferences; the key remains in Keystore. */
internal class VaultSecrets(context: Context) {
    private val preferences = context.getSharedPreferences("facet.secrets", Context.MODE_PRIVATE)
    private val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val alias = "red.sjer.facet.credentials.v1"

    private fun key(): SecretKey {
        val existing = keystore.getKey(alias, null)
        if (existing != null) return existing as SecretKey
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    @Synchronized fun put(name: String, secret: ByteArray) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        val frame = cipher.iv + cipher.doFinal(secret)
        check(preferences.edit().putString(name, Base64.encodeToString(frame, Base64.NO_WRAP)).commit())
    }

    @Synchronized fun get(name: String): ByteArray? {
        val stored = preferences.getString(name, null) ?: return null
        val frame = Base64.decode(stored, Base64.NO_WRAP)
        require(frame.size >= 28) { "Stored credential frame is corrupt." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, frame.copyOfRange(0, 12)))
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        return cipher.doFinal(frame.copyOfRange(12, frame.size))
    }

    @Synchronized fun remove(name: String) { check(preferences.edit().remove(name).commit()) }
}
