import axios from "axios";

export async function isUrlValid(url: string): Promise<boolean> {
  try {
    await axios.get(url);
    return true;
  } catch (exception) {
    console.error(exception);
    return false;
  }
}
