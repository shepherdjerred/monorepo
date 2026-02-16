import classNames from "classnames";
import * as React from "react";
import "./Modal.css";

export interface ModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  isVisible: boolean;
}

export function Modal({ children, onClose, isVisible, title }: ModalProps): React.ReactElement {
  const modalClasses: string = classNames({
    modal: true,
    "is-clipped": true,
    "is-active": isVisible,
  });
  return (
    <div className={modalClasses}>
      <div className="modal-background" onClick={onClose}></div>
      <div className="modal-card">
        <header className="modal-card-head">
          <p className="modal-card-title">{title}</p>
          <button className="delete" aria-label="close" onClick={onClose}></button>
        </header>
        <section className="modal-card-body">{children}</section>
      </div>
    </div>
  );
}
