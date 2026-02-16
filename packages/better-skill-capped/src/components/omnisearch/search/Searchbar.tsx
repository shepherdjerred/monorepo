import React, { ChangeEvent } from "react";
import "./Searchbar.sass";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch } from "@fortawesome/free-solid-svg-icons";
import { Container } from "../../Container";

export interface FilterBarProps {
  onValueUpdate: (newValue: string) => void;
  placeholder: string;
}

export interface FilterBarState {
  value: string;
}

export class Searchbar extends React.Component<FilterBarProps, FilterBarState> {
  constructor(props: FilterBarProps) {
    super(props);
    this.state = {
      value: "",
    };
  }

  onUpdate(event: ChangeEvent<HTMLInputElement>): void {
    event.persist();
    this.setState((state) => {
      return {
        ...state,
        value: event.target.value || "",
      };
    });
    this.props.onValueUpdate(event.target.value);
  }

  render(): React.ReactNode {
    return (
      <section className="hero searchbar is-small">
        <div className="hero-body">
          <Container>
            <div className="field">
              <div className="control has-icons-left">
                <input
                  className="input is-large"
                  type="text"
                  value={this.state.value}
                  placeholder={this.props.placeholder}
                  onChange={this.onUpdate.bind(this)}
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
}
