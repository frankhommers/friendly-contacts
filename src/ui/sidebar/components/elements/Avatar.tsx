import * as React from "react";
import { gravatarHash, gravatarUrl } from "src/ui/avatar/gravatar";
import { useSettings } from "src/ui/hooks/settingsHook";
import { photoLineToV4 } from "src/util/photoLine";

/** Pixels asked from Gravatar: twice the 100px card avatar, for sharp screens. */
const GRAVATAR_SIZE = 200;

interface AvatarProps {
	photoUrl?: string;
	firstName: string;
	lastName: string;
  functionalName: string;
  /** Email address for Gravatar, when it is switched on and there is no photo. */
  email?: string;
}

export const Avatar = (props: AvatarProps) => {
	const [hasImageError, setHasImageError] = React.useState(false);
	let initials = ''

    if (props.firstName && props.lastName) {
      initials =`${props.firstName.charAt(0).toUpperCase()}${props.lastName.charAt(0).toUpperCase()}`;
    } else if (props.functionalName) {
      initials = `${props.functionalName.charAt(0).toUpperCase()}${props.functionalName.charAt(1).toUpperCase()}`;
    }

  React.useEffect(() => {
    setHasImageError(false);
  }, [props.photoUrl]);

  const photo = props.photoUrl && !hasImageError ? (photoLineToV4(props.photoUrl) || props.photoUrl) : undefined;
  const gravatar = useSettings()?.gravatar;
  const gravatarEmail = !photo && gravatar?.enabled ? props.email : undefined;
  const fallback = gravatar?.fallback ?? "initials";
  const [gravatarSrc, setGravatarSrc] = React.useState<string | undefined>(undefined);
  const [gravatarFailed, setGravatarFailed] = React.useState(false);

  React.useEffect(() => {
    setGravatarFailed(false);
    setGravatarSrc(undefined);
    if (!gravatarEmail) return;
    let current = true;
    gravatarHash(gravatarEmail)
      .then((hash) => { if (current) setGravatarSrc(gravatarUrl(hash, GRAVATAR_SIZE, fallback)); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [gravatarEmail, fallback]);

  const src = photo ?? (gravatarFailed ? undefined : gravatarSrc);

  return (
		<div className="avatar-initials">
			{src ? (
				<img
					src={src}
					alt=""
					referrerPolicy="no-referrer"
					onError={() => (photo ? setHasImageError(true) : setGravatarFailed(true))}
				/>
			) : (
				<svg
					width="100%"
					height="100%"
					viewBox="0 0 100 100"
					xmlns="http://www.w3.org/2000/svg"
				>
					<text
						x="50%"
						y="50%"
						textAnchor="middle"
						dy=".3em"
						fontSize="30"
					>
						{initials}
					</text>
				</svg>
			)}
		</div>
	);
};

export default Avatar;
