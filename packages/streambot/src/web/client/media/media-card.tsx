import { Link } from "react-router";
import { Artwork } from "./artwork.tsx";
import { PlayActions } from "./play-actions.tsx";
import { itemDetail, type MediaItem } from "./row-model.ts";
import "@shepherdjerred/streambot/web/client/styles/row.css";

/** A poster: the same item, actions and feedback as a row, laid out around its artwork. */
export function MediaCard(props: { item: MediaItem }) {
  const { item } = props;
  return (
    <li className="card">
      <Artwork item={item} shape="poster" />
      <div className="card-text">
        {item.href === undefined ? (
          <span className="row-title">{item.title}</span>
        ) : (
          <Link className="row-title row-link" to={item.href}>
            {item.title}
          </Link>
        )}
        <span className="row-detail">{itemDetail(item)}</span>
      </div>
      <PlayActions item={item} />
    </li>
  );
}
