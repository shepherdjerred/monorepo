import React from "react";
import "./Searchbar.sass";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { Container } from "#src/components/container";

export type SearchbarProps = {
  value: string;
  onValueUpdate: (newValue: string) => void;
  placeholder: string;
};

export function Searchbar({
  value,
  onValueUpdate,
  placeholder,
}: SearchbarProps): React.ReactElement {
  return (
    <section className="hero searchbar is-small">
      <div className="hero-body">
        <Container>
          <div className="field">
            <div className="control has-icons-left">
              <input
                className="input is-large"
                type="text"
                value={value}
                placeholder={placeholder}
                onChange={(event) => {
                  onValueUpdate(event.target.value);
                }}
              />
              <span className="icon is-small is-left">
                <FontAwesomeIcon icon={faSearch} />
              </span>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}
