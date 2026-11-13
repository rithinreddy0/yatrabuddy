import React from 'react'
import './BuddyMascot.css'

const labels = {
  idle: 'Ready to help',
  listening: 'Listening',
  thinking: 'Looking that up',
  speaking: 'Speaking',
}

export function BuddyMascot({state = 'idle'}) {
  const activeState = Object.hasOwn(labels, state) ? state : 'idle'
  return <div className="buddy-mascot" data-state={activeState}>
    <div className="buddy-mascot-scene" aria-hidden="true">
      <div className="buddy-mascot-aura"/>
      <div className="buddy-mascot-orbit"/>
      <div className="buddy-mascot-shadow"/>
      <div className="buddy-mascot-character">
        <span className="buddy-mascot-arm buddy-mascot-arm-left"/>
        <span className="buddy-mascot-arm buddy-mascot-arm-right"/>
        <span className="buddy-mascot-foot buddy-mascot-foot-left"/>
        <span className="buddy-mascot-foot buddy-mascot-foot-right"/>
        <div className="buddy-mascot-body">
          <span className="buddy-mascot-sheen"/>
          <div className="buddy-mascot-face">
            <span className="buddy-mascot-eye"/>
            <span className="buddy-mascot-eye"/>
            <span className="buddy-mascot-mouth"/>
          </div>
        </div>
      </div>
    </div>
    <div className="buddy-mascot-caption">
      <span className="buddy-mascot-levels" aria-hidden="true"><i/><i/><i/><i/><i/></span>
      <span>{labels[activeState]}</span>
    </div>
  </div>
}
