export default function Form() {
  return (
    <>
      <form>
        <label>Repository URL</label>
        <input type="text" name="repository" />
        <button type="submit">Add</button>
      </form>
    </>
  );
}
