import styles from "./PoweredByPlatmatics.module.css";

type Props = {
  /** Client domain, used as utm_source. Example: "whitleycs.com" */
  site: string;
  /** "badge" is a quiet pill. "inline" is text plus mark, no chrome. */
  variant?: "badge" | "inline";
  /** Lead-in text. Default "Powered by". "Built by" and "Site by" also read well. */
  label?: string;
  className?: string;
};

const HOME = "https://platmatics.com/";

export function poweredByHref(site: string) {
  const url = new URL(HOME);
  url.searchParams.set("utm_source", site.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  url.searchParams.set("utm_medium", "footer-badge");
  url.searchParams.set("utm_campaign", "powered-by");
  return url.toString();
}

export default function PoweredByPlatmatics({
  site,
  variant = "badge",
  label = "Powered by",
  className,
}: Props) {
  const classes = [styles.root, styles[variant], className].filter(Boolean).join(" ");

  return (
    <a
      href={poweredByHref(site)}
      target="_blank"
      rel="noopener"
      className={classes}
      title="Websites and software by Platmatics"
    >
      <svg
        className={styles.mark}
        viewBox="40 80 432 400"
        width="16"
        height="16"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M256,100 L441,171 L256,242 L71,171 Z" fill="currentColor" />
        <path d="M71,171 L256,242 L256,272 L71,201 Z" fill="currentColor" fillOpacity="0.55" />
        <path d="M441,171 L256,242 L256,272 L441,201 Z" fill="currentColor" fillOpacity="0.75" />
        <path
          className={styles.plate}
          d="M256,313 L441,384 L256,455 L71,384 Z"
          fill="currentColor"
        />
        <path
          d="M256,313 L441,384 L256,455 L71,384 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="26"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>{" "}
        <span className={styles.brand}>Platmatics</span>
      </span>
    </a>
  );
}
