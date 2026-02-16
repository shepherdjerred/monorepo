import * as React from "react";
import { Modal } from "./Modal";

export interface TipsModalProps {
  onClose: () => void;
  isVisible: boolean;
}

export function TipsModal({ onClose, isVisible }: TipsModalProps): React.ReactElement {
  return (
    <Modal title="Search Tips" onClose={onClose} isVisible={isVisible}>
      <div>
        <p>
          Better Skill Capped uses a technique called fuzzy searching to display search results. Fuzzy searching shows
          not only exact matches, but also results that are somewhat similar to your query. This lets you not worry
          about making typos when searching, or having to know the exact thing you&apos;re looking for.
        </p>
        <br />
        <p>
          Below is a list of search operators that advanced users can employ to more powerfully search Skill
          Capped&apos;s videos.
        </p>
        <br />
        <table className="table">
          <thead>
            <tr>
              <th>Operator</th>
              <th>Example</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>No Operator</td>
              <td>Tryndamere</td>
              <td>Results that fuzzy match &apos;Tryndamere&apos;</td>
            </tr>
            <tr>
              <td>=</td>
              <td>=Jax Tips</td>
              <td>Results that exactly match &apos;Jax Tips&apos;</td>
            </tr>
            <tr>
              <td>&apos;</td>
              <td>&apos;Jungle</td>
              <td>Results that include &apos;Jungle&apos;</td>
            </tr>
            <tr>
              <td>!</td>
              <td>!Evelyn</td>
              <td>Results that do not include &apos;Evelyn&apos;</td>
            </tr>
            <tr>
              <td>^</td>
              <td>&apos;How to</td>
              <td>Results that start with &apos;How to&apos;</td>
            </tr>
            <tr>
              <td>!^</td>
              <td>!^Season 10</td>
              <td>Results that do not start with &apos;Season 10&apos;</td>
            </tr>
            <tr>
              <td>$</td>
              <td>Item Guide$</td>
              <td>Results that end with &apos;Item Guide&apos;</td>
            </tr>
            <tr>
              <td>!$</td>
              <td>!Pro Strategy$</td>
              <td>Results that do not end with &apos;Pro Strategy&apos;</td>
            </tr>
          </tbody>
        </table>
        <p>White space acts as an AND operator, while a pipe character, i.e. |, acts as an OR operator.</p>
        <br />
        <p>
          Example: &apos;Tryndamere Strategy&apos; will search for results that contain both &apos;Tryndamere&apos; AND
          &apos;Strategy&apos;
        </p>
        <br />
        <p>
          Example: &apos;Item|Guide&apos; will search for results that contain either &apos;Item&apos; OR
          &apos;Guide&apos; or both words.
        </p>
      </div>
    </Modal>
  );
}
