// Mass calendar only. SOTW lives in the sotw table, not here.
const MASS = "(category IS NULL OR category != 'sotw')";

function isMass(event) {
  return event && event.category !== 'sotw';
}

module.exports = { MASS, isMass };
