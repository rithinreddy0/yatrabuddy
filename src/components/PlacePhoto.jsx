import React,{useState} from 'react'

function https(value){
  try{return new URL(value).protocol==='https:'?value:null}catch{return null}
}

export function PlacePhoto({place,hideUnavailable=false,onUnavailable,compact=false,className='',fallback=false}){
  const photo=place.photo
  const urls=[...new Set([https(photo?.url),https(photo?.originalUrl)].filter(Boolean))]
  const [failedUrl,setFailedUrl]=useState(null)
  const [failedOriginal,setFailedOriginal]=useState(null)
  const url=urls.find(candidate=>candidate!==failedUrl&&candidate!==failedOriginal)
  const hasPhoto=Boolean(url)
  const source=https(photo?.sourceUrl)
  const illustration=fallback&&!hasPhoto?({Nature:'/images/kerala.jpg',Sight:'/images/hyderabad.jpg',Shopping:'/images/kutch.jpg',Stay:'/images/booking-lobby.jpg',Activity:'/images/travel-journal.jpg'}[place.category]||'/images/hero.jpg'):null
  if(hideUnavailable&&!hasPhoto&&!source&&!illustration)return null
  const license=https(photo?.licenseUrl)
  function imageFailed() {
    if (urls[0]===url) setFailedUrl(url)
    else setFailedOriginal(url)
    if (!urls.some(candidate=>candidate!==url&&candidate!==failedUrl&&candidate!==failedOriginal)) onUnavailable?.()
  }
  if(compact)return hasPhoto||illustration ? <img className={className} src={url||illustration} alt={illustration?'Illustrative travel photo':''}
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={hasPhoto?imageFailed:undefined}/> : null
  return <figure className={'place-photo'+(!hasPhoto&&hideUnavailable?' place-photo-source-only':'')}>
    {hasPhoto?<><img src={url} alt={photo.kind==='nearby'?`Around ${place.name}`:place.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={imageFailed}/>
      <figcaption>{photo.kind==='nearby'&&'Nearby photo · '}{photo.credit}{photo.authors?.map((author,index)=><span key={index}>{https(author.url)?<a href={author.url} target="_blank" rel="noreferrer">{author.name}</a>:author.name} · </span>)}{source&&<>{photo.credit&&' · '}<a href={source} target="_blank" rel="noreferrer">{photo.authors?'Photo on Google Maps':'Photo source'}</a></>}
        {photo.license&&<> · {license?<a href={license} target="_blank" rel="noreferrer">{photo.license}</a>:photo.license}</>}
      </figcaption></>:<>
      {source&&<figcaption><a href={source} target="_blank" rel="noreferrer">Open original photo</a></figcaption>}
    </>}
    {illustration&&<><img src={illustration} alt="" loading="lazy" decoding="async"/><figcaption>Illustrative travel photo</figcaption></>}
  </figure>
}
