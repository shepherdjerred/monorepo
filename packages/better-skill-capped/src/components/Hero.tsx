import React from "react";
import classNames from "classnames/bind";

export interface HeroProps {
  title: string;
  subtitle?: string;
  color?: Color;
  size?: Size;
}

export enum Color {
  NONE,
  TEAL,
  RED,
}

export enum Size {
  SMALL,
  MEDIUM,
  LARGE,
  FULL,
  FULL_WITH_NAVBAR,
}

export class Hero extends React.PureComponent<HeroProps, unknown> {
  getClassNameForColor(color: Color): string {
    switch (color) {
      case Color.NONE:
        return "";
      case Color.RED:
        return "is-danger";
      case Color.TEAL:
        return "is-primary";
    }
  }

  getClassNameForSize(size: Size): string {
    switch (size) {
      case Size.SMALL:
        return "is-small";
      case Size.MEDIUM:
        return "is-medium";
      case Size.LARGE:
        return "is-large";
      case Size.FULL:
        return "is-fullheight";
      case Size.FULL_WITH_NAVBAR:
        // In Bulma v1.0+, is-fullheight-with-navbar was removed
        // Use is-fullheight with custom min-height calculation
        return "is-fullheight";
    }
  }

  render(): React.ReactNode {
    const cx = classNames.bind({});
    const sectionClasses: string = cx({
      hero: true,
      "is-dark": true,
      [this.getClassNameForColor(this.props.color ?? Color.NONE)]: true,
      [this.getClassNameForSize(this.props.size ?? Size.SMALL)]: true,
    });

    return (
      <section className={sectionClasses}>
        <div className="hero-body">
          <div className="container">
            <h1 className="title">{this.props.title}</h1>
            <h2 className="subtitle">{this.props.subtitle}</h2>
          </div>
        </div>
      </section>
    );
  }
}
