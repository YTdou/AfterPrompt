import "./styles.css";
import { EditorApp } from "./ui/editor-app";

const host = document.querySelector<HTMLElement>("#app");
if (!host) throw new Error("Application host not found.");

new EditorApp(host);
