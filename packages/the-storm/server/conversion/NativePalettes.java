import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;

/** Exact native padded palette storage, shared by block and quart-biome transplantation. */
public final class NativePalettes {
  private NativePalettes() {}

  static List<Tag> decode(CompoundTag storage, int count, int minimumBits) {
    var palette = storage.getList("palette").orElseThrow();
    if (palette.isEmpty() || palette.size() > count) throw new IllegalStateException("Invalid native palette");
    var bits = Math.max(minimumBits, 32 - Integer.numberOfLeadingZeros(palette.size() - 1));
    var perLong = 64 / bits;
    var words = palette.size() == 1 ? new long[0] : storage.getLongArray("data").orElseThrow();
    if (palette.size() > 1 && words.length != (count + perLong - 1) / perLong) {
      throw new IllegalStateException("Invalid padded native palette data");
    }
    var result = new ArrayList<Tag>(count);
    for (var index = 0; index < count; index++) {
      var selected = palette.size() == 1 ? 0 : (int) ((words[index / perLong]
          >>> ((index % perLong) * bits)) & ((1L << bits) - 1));
      if (selected >= palette.size()) throw new IllegalStateException("Palette index is outside its palette");
      // Entries are read-only inputs. Encoding copies each unique entry, so editing the cell list
      // never mutates either input palette and avoids millions of identical NBT deep copies.
      result.add(palette.get(selected));
    }
    return result;
  }

  static CompoundTag encode(List<Tag> values, int minimumBits) {
    if (values.isEmpty()) throw new IllegalArgumentException("An empty palette cannot be encoded");
    var indexes = new HashMap<Tag, Integer>();
    var palette = new ListTag();
    for (var value : values) {
      if (!indexes.containsKey(value)) {
        indexes.put(value, indexes.size());
        palette.add(value.copy());
      }
    }
    var result = new CompoundTag();
    result.put("palette", palette);
    if (palette.size() > 1) {
      var bits = Math.max(minimumBits, 32 - Integer.numberOfLeadingZeros(palette.size() - 1));
      var perLong = 64 / bits;
      var words = new long[(values.size() + perLong - 1) / perLong];
      for (var index = 0; index < values.size(); index++) {
        words[index / perLong] |= (long) indexes.get(values.get(index)) << ((index % perLong) * bits);
      }
      result.putLongArray("data", words);
    }
    if (!values.equals(decode(result, values.size(), minimumBits))) {
      throw new IllegalStateException("Native palette roundtrip changed values");
    }
    return result;
  }
}
