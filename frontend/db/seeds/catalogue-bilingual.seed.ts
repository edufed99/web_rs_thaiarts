import type { DataSource } from "typeorm";

export interface ContextTranslation {
  name: string;
  nameEn: string;
  descriptionEn: string;
}

export interface TaxonomyTranslation {
  id: number;
  nameEn: string;
}

export interface ItemTranslation {
  name: string;
  nameEn: string;
  descriptionEn: string;
  categoryGroupEn: string;
  performanceTypeEn: string;
}

export interface KeywordTranslation {
  name: string;
  nameEn: string;
}

export const CONTEXT_TRANSLATIONS: ContextTranslation[] = [
  {
    "name": "วันสงกรานต์",
    "nameEn": "Songkran Festival (Thai Water Festival)",
    "descriptionEn": "Traditional Thai New Year celebration marked by water blessing rituals, family reunions, and festive folk dances."
  },
  {
    "name": "วันขึ้นปีใหม่",
    "nameEn": "New Year's Day Celebration",
    "descriptionEn": "Celebration welcoming the calendar New Year with auspicious performances and joyful blessings."
  },
  {
    "name": "การเผยแพร่วัฒนธรรมในประเทศ",
    "nameEn": "Domestic Cultural Exhibition & Festival",
    "descriptionEn": "National cultural showcases, provincial heritage fairs, and educational exhibitions across Thailand."
  },
  {
    "name": "การเผยแพร่วัฒนธรรมต่างประเทศ",
    "nameEn": "International Cultural Exchange & Diplomacy",
    "descriptionEn": "Cultural diplomacy and overseas goodwill tours representing authentic Thai classical performing arts on the global stage."
  },
  {
    "name": "งานต้อนรับอาคันตุกะ",
    "nameEn": "Reception of State Guests & Dignitaries",
    "descriptionEn": "Formal banquets and welcoming ceremonies honoring visiting heads of state, foreign delegations, and esteemed dignitaries."
  },
  {
    "name": "งานทำบุญ",
    "nameEn": "Buddhist Merit-Making Ceremony",
    "descriptionEn": "Traditional merit-making ceremonies, sanghadana offerings, and communal blessings fostering spiritual welfare."
  },
  {
    "name": "งานวันเกิด",
    "nameEn": "Birthday Celebration & Longevity Milestone",
    "descriptionEn": "Auspicious gatherings commemorating birthdays and longevity anniversaries with celebratory blessing performances."
  },
  {
    "name": "งานเปิดบริษัท",
    "nameEn": "Grand Opening & Corporate Ceremony",
    "descriptionEn": "Corporate inaugurations, business openings, and commercial milestones invoking prosperity and commercial success."
  },
  {
    "name": "วันลอยกระทง",
    "nameEn": "Loy Krathong Festival (Festival of Lights)",
    "descriptionEn": "Full moon lantern floating festival honoring the Goddess of Waters (Phra Mae Khongkha) with radiant nocturnal pageantry."
  },
  {
    "name": "งานแต่งงาน",
    "nameEn": "Wedding Ceremony & Celebration",
    "descriptionEn": "Nuptial ceremonies and wedding receptions accompanied by romantic and harmonious blessing dances."
  },
  {
    "name": "งานขึ้นบ้านใหม่",
    "nameEn": "Housewarming Ceremony",
    "descriptionEn": "Auspicious ceremonies celebrating the occupancy of a new home, blessing the dwelling with happiness and fortune."
  },
  {
    "name": "วันตรุษจีน",
    "nameEn": "Chinese New Year Celebration",
    "descriptionEn": "Spring Festival festivities welcoming lunar new year prosperity with vibrant multicultural arts and joyous performances."
  },
  {
    "name": "งานบวงสรวง",
    "nameEn": "Votive Worship & Sacred Dedication Ceremony",
    "descriptionEn": "Solemn propitiation and consecration rituals invoking grace, divine favor, and protection from revered deities and tutelary spirits."
  },
  {
    "name": "งานสวดมนต์ข้ามปี",
    "nameEn": "New Year Eve Chanting & Spiritual Vigil",
    "descriptionEn": "Year-end Buddhist meditation and overnight paritta chanting welcoming the new calendar year with inner peace."
  },
  {
    "name": "งานเทศมหาชาติ",
    "nameEn": "The Great Birth Sermon (Vessantara Jataka Recitation)",
    "descriptionEn": "Solemn recitation ceremonies of Prince Vessantara's Great Bodhisattva Perfections across the sacred thirteen cantos."
  },
  {
    "name": "งานสโมสรสันนิบาต",
    "nameEn": "State Reception & Diplomatic Gala",
    "descriptionEn": "Official state galas, diplomatic convocations, and national commemorative assemblies held in prestigious royal venues."
  },
  {
    "name": "งานไหว้ครู",
    "nameEn": "Wai Khru (Teachers & Masters Homage Ceremony)",
    "descriptionEn": "Sacred rite of paying homage and spiritual gratitude to ancestral masters, gurus, and deities of Thai performing arts."
  },
  {
    "name": "วันวิสาขบูชา",
    "nameEn": "Visakha Bucha Day (Buddha Day)",
    "descriptionEn": "The holiest Buddhist festival commemorating the Lord Buddha's Birth, Supreme Enlightenment, and Parinirvana."
  },
  {
    "name": "วันเข้าพรรษา",
    "nameEn": "Khao Phansa (Buddhist Lent Commencement)",
    "descriptionEn": "Observance marking the beginning of the three-month monastic rains retreat, highlighted by carved candle processions."
  },
  {
    "name": "วันออกพรรษา",
    "nameEn": "Ok Phansa (End of Buddhist Lent)",
    "descriptionEn": "Celebrations marking the conclusion of the Buddhist rains retreat, featured by illuminated boat processions and merit ceremonies."
  },
  {
    "name": "งานประชุมสงฆ์",
    "nameEn": "Sangha Assembly & Ecclesiastical Gathering",
    "descriptionEn": "Solemn ecclesiastical assemblies, monastic synods, and major temple council convocations."
  },
  {
    "name": "งานสวดอภิธรรม",
    "nameEn": "Abhidhamma Funeral Wake & Chanting",
    "descriptionEn": "Evening funeral wake services featuring deep philosophical chanting of the Abhidhamma Pitaka in honor of the departed."
  },
  {
    "name": "งานฌาปนกิจศพ",
    "nameEn": "Cremation & Memorial Ceremony",
    "descriptionEn": "Solemn funeral cremation services and final rites offering merit, respectful remembrance, and farewell to the deceased."
  },
  {
    "name": "งานเฉลิมพระชนมพรรษาพระบรมวงศานุวงศ์",
    "nameEn": "Royal Birthday & National Jubilee Celebration",
    "descriptionEn": "Grand national celebrations, royal court jubilees, and public festivities commemorating royal birthdays of the Thai Monarchy."
  },
  {
    "name": "งานพระราชทานเพลิงศพ",
    "nameEn": "Royal Cremation & State Funeral Rite",
    "descriptionEn": "High-honor royal funeral cremation ceremonies presided over with state regalia for royal figures and distinguished dignitaries."
  }
];

export const TAXONOMY_TRANSLATIONS: TaxonomyTranslation[] = [
  {
    "id": 1,
    "nameEn": "Literature and Mythological Beings"
  },
  {
    "id": 2,
    "nameEn": "Character Onomastics and Roles"
  },
  {
    "id": 3,
    "nameEn": "Mythological Deities, Asuras, and Supernatural Beings"
  },
  {
    "id": 4,
    "nameEn": "Protagonists and Dramatic Roles"
  },
  {
    "id": 5,
    "nameEn": "Social Hierarchy and Status in Literature"
  },
  {
    "id": 6,
    "nameEn": "Royal Titles and Kinship Systems"
  },
  {
    "id": 7,
    "nameEn": "Performing Arts and Music"
  },
  {
    "id": 8,
    "nameEn": "Dramatic Arts and Dance Choreography"
  },
  {
    "id": 9,
    "nameEn": "Dance Postures and Performance Traditions"
  },
  {
    "id": 10,
    "nameEn": "Performance Styles and Regional Dances"
  },
  {
    "id": 11,
    "nameEn": "Musicology and Vocal Arts"
  },
  {
    "id": 12,
    "nameEn": "Musical Modes and Song Typology"
  },
  {
    "id": 13,
    "nameEn": "Musical Instruments and Ensembles"
  },
  {
    "id": 14,
    "nameEn": "Artists, Roles, and Artistic Virtuosity"
  },
  {
    "id": 15,
    "nameEn": "Performance Techniques and Stage Skills"
  },
  {
    "id": 16,
    "nameEn": "Rituals, Beliefs, and Cultural Traditions"
  },
  {
    "id": 17,
    "nameEn": "Religious and Belief Systems"
  },
  {
    "id": 18,
    "nameEn": "Sacred Concepts and Holy Entities"
  },
  {
    "id": 19,
    "nameEn": "Traditions, Customs, and Ceremonies"
  },
  {
    "id": 20,
    "nameEn": "Key Ceremonies and Social Observances"
  },
  {
    "id": 21,
    "nameEn": "Animism, Folklore, and Esotericism"
  },
  {
    "id": 22,
    "nameEn": "Spiritual Apotropaism and Supernatural Powers"
  },
  {
    "id": 23,
    "nameEn": "Historical, Geographical, and Spatial Context"
  },
  {
    "id": 24,
    "nameEn": "Geography and Territories"
  },
  {
    "id": 25,
    "nameEn": "Administrative Regions and Topography"
  },
  {
    "id": 26,
    "nameEn": "Mythical Realms and Historical Landscapes"
  },
  {
    "id": 27,
    "nameEn": "Historical Eras and Notable Events"
  },
  {
    "id": 28,
    "nameEn": "Chronology and Military History"
  },
  {
    "id": 29,
    "nameEn": "Cultural Spaces and Institutions"
  },
  {
    "id": 30,
    "nameEn": "Performance Venues and Royal Precincts"
  },
  {
    "id": 31,
    "nameEn": "Material Culture, Fine Arts, and Craftsmanship"
  },
  {
    "id": 32,
    "nameEn": "Fine Arts and Visual Arts"
  },
  {
    "id": 33,
    "nameEn": "Artistic Craftsmanship and Traditional Methods"
  },
  {
    "id": 34,
    "nameEn": "Architecture and Buddhist Art"
  },
  {
    "id": 35,
    "nameEn": "Sacred Sanctuaries and Religious Artifacts"
  },
  {
    "id": 36,
    "nameEn": "Textiles, Regalia, and Costumery"
  },
  {
    "id": 37,
    "nameEn": "Sartorial Conventions and Prop Weaponry"
  },
  {
    "id": 38,
    "nameEn": "Materials and Gemstones"
  },
  {
    "id": 39,
    "nameEn": "Natural Resources and Precious Gems"
  },
  {
    "id": 40,
    "nameEn": "Ethnic Groups, Communities, and Ways of Life"
  },
  {
    "id": 41,
    "nameEn": "Social Identity and Demographics"
  },
  {
    "id": 42,
    "nameEn": "Ethnic Minorities and Local Communities"
  },
  {
    "id": 43,
    "nameEn": "Social Structure and Historical Figures"
  },
  {
    "id": 44,
    "nameEn": "Social Ranks and Civic Functions"
  },
  {
    "id": 45,
    "nameEn": "Traditional Livelihoods and Agrarian Economy"
  },
  {
    "id": 46,
    "nameEn": "Occupational Practices and Culinary Culture"
  },
  {
    "id": 47,
    "nameEn": "Social Customs, Folkways, and Everyday Life"
  },
  {
    "id": 48,
    "nameEn": "Folk Practices and Ethnobotany"
  }
];

export const ITEM_TRANSLATIONS: ItemTranslation[] = [
  {
    "name": "กรุงเทพ",
    "nameEn": "Krung Thep (Bangkok)",
    "descriptionEn": "Krung Thep is a performance piece inspired by the name “Krung Thep Maha Nakhon”, which is the formal name of Thailand’s capital city: Bangkok. The name “Krung Thep Maha Nakhon” is actually an abbreviation of the city’s full name, which is listed in Guinness World Records as the world's longest place name. The full meaning of the name refers to this metropolis as a great city created by mighty gods. Thus, the performance Krung Thep pays homage to the grandeur of Bangkok, as well as its symbolic connotation to heavenly abodes. The choreography of this performance demonstrates the dance of heavenly beings with the integration of Nang Yai (Thai Grand Shadow Play) to portray important landmarks of Bangkok.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "กีปัสเรนัง",
    "nameEn": "Kipas Renang (Renang Dance)",
    "descriptionEn": "Kipas Renang is a dance inspired the Burong Si-ngo parade of Lower Southern Thailand, particularly Pattani Province. This parade is a tradition whereby local ethnic Malay communities construct a large model of Burong Si-ngo (a mighty mythical bird) to display in a procession. The Renang, the namesake of this dance, is a type of fan that is displayed as a part of the Burong Si-ngo parade. The Kipas Renang dance focuses on displaying fan movements through choreography. It is believed that the Renang fan symbolizes peace, while the unique sound of a fluttering Renang symbolizes the dispelling of evil and sickness.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "จตุรภาคี",
    "nameEn": "Chatura Pha-khee (The Four Regions)",
    "descriptionEn": "Chatura Pha-khee refers to the Four Regions of Thailand. This inspiring performance combines the ethnic identity of each region into one show, including Fon Thi from the North, Ram Thoet Thoeng from the Central, Tari Kipas from the South, and Lam Phloen from the Northeast.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "เจ้าพระยานที",
    "nameEn": "Chao Phraya Nathi (The Chao Phraya River)",
    "descriptionEn": "This dance pays homage to a major river of Thailand: the Chao Phraya River . Formed from the waters of the Ping, Wang, Yom and Nan Rivers, this stream has been sustaining the lives of people since ancient times, fostering generations of history, traditions, and heritage. Today, the Chao Phraya River is known far and wide across the world. Thus, the Chao Phraya Nathi dance was created with great reverence and gratitude towards this river , praising it as a stream of cultural Significance and national beauty.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ชาติพันธุ์สราญ",
    "nameEn": "Chat Ti Phan Saran (Merry Ethnic Groups)",
    "descriptionEn": "Chat Ti Phan Saran is a creative performance showcasing the five ethnic groups that live in Nakhon Pathom Province: (1) Lao Krang, (2) Thai Song Dam (Tai Dam), (3) Lao Wiang, (4) Thai Raman (Mon), and (5) Thai Chinese. The dance highlights diversity in cultures, traditions, and ways of life, as well as the harmony between the communities.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ชาวดอย",
    "nameEn": "Chao Doi (Hill Folks)",
    "descriptionEn": "Chao Doi is a dance inspired by the way of life of hill tribe people in Northern Thailand. The dance depicts the hill tribes’ agricultural lifestyle, with strong connection to natural surroundings. Local games are also highlighted in this show.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ตะกล้อล้อท่า",
    "nameEn": "Takraw Lor Tha (Thai Kick Volleyball Dance)",
    "descriptionEn": "Takraw Lor Tha is a performance inspired by the Takraw: a traditional sport and pastime of Thailand since ancient times. The performance showcases essential postures of playing Takraw, including the skillful use of head, elbows, knees, and feet to manipulate the rattan ball in mid-air.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "นบนที",
    "nameEn": "Nop Na-thi (Revering the Waters)",
    "descriptionEn": "Nop Na-thi is the performance depicting Loi Krathong: a Thai festival celebrated annually to pay respect to Phra Mae Khongkha, the Goddess of Water . Thais consider water to be the source of life. Thus, Loi Krathong is a chance for people to show gratitude to bodies of water , such as rivers. The dance captures the attitude of respect and gratitude exhibited during the festival.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "นักษัตร",
    "nameEn": "Nak-Sat (The Zodiac)",
    "descriptionEn": "Nak-sat means “zodiac”. As the name suggests, this performance is a reference to the traditional twelve yearly zodiacs of the traditional Thai calendar . The zodiacs are depicted as different animals representing deities who protect mankind. The dance utilizes twelve dancers, with a focus of on displaying a variety of graceful choreography.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "นาฏ ณ วัง",
    "nameEn": "Nata Na Wang (Front Palace Dance)",
    "descriptionEn": "Nata Na Wang is a performance inspired by the Phra Ratchawang Bowon Sathan Mongkhon Palace in Bangkok, colloquially known as the “Front Palace”. This historic site is an important hub for many forms of traditional performing arts, such as Khon, Lakhon, Nang Yai, Thai puppetry, Chinese opera, and Aew Khaen. The dance thus combines a variety of performances, conveying them through an aesthetic that reflects the splendour of the royal court. The purpose of this performance is to pay homage to the Front Palace’s role as a centre traditional artforms preservation and promotion.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "นาฏยมวยไทย",
    "nameEn": "Nataya MuayThai (MuayThai Dance)",
    "descriptionEn": "Nataya MuayThai is inspired by MuayThai: the martial art of the Thai people with a history dating back to ancient times. The choreography is adapted from barehanded fighting techniques, which has been developed by the ancestors and passed down through generations. The dance also incorporates elements of Khon and traditional Thai dance.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ผืนไท",
    "nameEn": "Phuen Thai (Thai Cultural Canvas)",
    "descriptionEn": "Phuen Thai is the performance inspired by the identity of each region of Thailand. It builds upon the beauty of classical and folk dance forms which are conveyed through carefully designed movements and creative use of stage space. The main props of the performance are large pieces of cloth representing the Thai nation and monarch. These two uniting forces spread out like the pieces of cloth, weaving different identities into a united and splendid Thai identity under the waving Thai flag.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "พนาธาร",
    "nameEn": "Pha-na Than (Forest and Streams)",
    "descriptionEn": "Pha-na Than is a performance that highlights the importance of forests and water , which sustains the lives of people. The performance utilizes elements of traditional dance to emulate the natural movements of the forest and water .",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ฟ้อนขันดอก",
    "nameEn": "Fon Khan Dok (Dance of the Tray of Flowers)",
    "descriptionEn": "Fon Khan Dok is a local dance of Northern Thailand that features a pedestal tray filled with flower blossoms. The dance utilizes Northern Thai choreography, with performers sprinkling the flowers towards audiences to bless them with good luck.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ฟ้อนลีลาวดี",
    "nameEn": "Fon Lilawadi (Frangipani Dance)",
    "descriptionEn": "Lilawadi is the Thai name for the frangipani, a plant with beautiful fragrant flowers. Fon Lilawadi, or Frangipani Dance, is inspired a particular frangipani tree that grows outside of Wat Bowon Sathan Sutthawat Temple, also known as Wat Phra Kaew Wang Na. The tree more than 100 years old and is large in size. The choreography of the dance reflects the beauty of this tree.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ระบำม้า",
    "nameEn": "Rabam Ma (The Horse Dance)",
    "descriptionEn": "Rabam Ma is a lively classical dance created by master dancer Lamun Yamakupt for the dance-drama Chaiyachet (scene: Narai Thibodi). The dance mimics the energetic galloping, leaping, and playful movements of horses accompanied by traditional rhythmic drumming.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ระบำอยุธยา",
    "nameEn": "Rabam Ayutthaya (Ayutthaya Period Archaeological Dance)",
    "descriptionEn": "Rabam Ayutthaya is an archaeological dance created in 1986 initiated by master artist Seri Wangnaitham, depicting the artistic grandeur and courtly elegance of the Ayutthaya Kingdom, reflecting its rich multicultural heritage and classical dance traditions.",
    "categoryGroupEn": "Archaeological Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รับขวัญข้าว",
    "nameEn": "Rap Khwan Khao (Gratitude to the Rice Goddess)",
    "descriptionEn": "Rap Khwan Khao is a performance inspired by the traditional ceremony of paying homage to rice and Phra Mae Phosop, the Goddess of Rice. Rice is the main staple that sustains the lives of Thai people. Thus, this tradition reflects the reverence and gratitude that Thai people have towards this honourable grain. The Rap Khwan Khao performance aims to capture this attitude of reverence and gratitude in order to promote awareness of the importance of the earth as mankind’s source of food production. The dance also aims to promote the preservation of Thai traditions, knowledge, and heritage concerning rice production.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ล่องใต้",
    "nameEn": "Long Tai (Voyage to the South)",
    "descriptionEn": "Southern Thailand is a land of unique art, culture, and lifestyle. Long Tai is a performance piece that seeks to recreate the cheerful characteristics of the South through showcasing the region’s traditions, cultural elements, and way of living.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ลายเกราะ",
    "nameEn": "Lai Kro (Wooden-Block Percussion Dance)",
    "descriptionEn": "Lai Kro is a performance utilizing a local Northeastern Thai musical instrument known as Kro Lor or Kho Lor (wooden-block percussion). The performers dance to Northeastern Thai folk music, combining rhythms of the Kor Lor with Northeastern-style choreography.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ลีลาหมากแก๊ป",
    "nameEn": "Lila Mak Gap (Moves of Mak Gap)",
    "descriptionEn": "Lila Mak Gap is an energetic dance inspired by the Mak Gup-Gap percussion instrument. Its choreography mimics afterwork activities of women in Northeastern Thai communities, with dancers moving to the rhythm of folk music while playing Mak Gup-Gap.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "วิรัชสราญรมย์",
    "nameEn": "Virat Saranrom (Western Delight)",
    "descriptionEn": "Virat Saranrom is a performance inspired by Western-influenced fashion of men and women during the reign of King Rama VI (1910 - 1925). The performance showcases the mixture of cultures, with performers dancing to a combination of Thai and Western music. The costume mimics the period’s clothing style.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "สยามภารตะ",
    "nameEn": "Siam Bharata",
    "descriptionEn": "Siam Bharata comes from the term “Siam” (another name for Thailand) and “Bharat” (another name for India). The culture, art, and religions of India has been a major influence in Thai culture and society since ancient times, especially in the fields of dance and music. This performance tells the story of how Indian influences came to Thailand and, through time, merged with the local identity to create Thai dance today. The choreography utilizes movements of two classical Indian dance styles, Bharatanatyam and Odissi, alternated with traditional dance movements of the Thai royal court.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "สักการะเทวราช",
    "nameEn": "Sakkara Thewaraj (Glory to the King)",
    "descriptionEn": "Sakkara Thewaraj is a performance inspired by the Indra-phisek ceremony of the Ayutthaya period. The Indra-phisek ceremony is a form of coronation ceremony whereby the monarch is crowned through rituals that symbolizes blessings from Lord Indra, a revered Hindu deity. Public performances were held at the end of the ceremony as a form of entertainment. The costumes of the Sakkara Thewaraj performance are inspired by sculptures and regalia of Buddhist icons from the Ayutthaya period. The choreography, on the other hand, is based off a dance instruction manuscript from the Early Rattanakosin period and combined with standard Thai classical choreography. The performance pays homage to the Thai monarch as a representation of Lord Indra on earth.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "ออเจ้าชาวกรุงศรี",
    "nameEn": "Or Chao Chao Krung Si (Ladies of Ayutthaya)",
    "descriptionEn": "Or Chao Chao Krung Si is a dance inspired by stories of ladies in the Ayutthaya royal court. It is said that the noblewomen of Ayutthaya possessed great physical beauty and graceful mannerism. They donned themselves in stunning clothing and precious jewelleries. Their lifestyle was that of virtue and refinement. The Or Chao Chao Krung Si dance conveys the beauty and elegance of Ayutthayan ladies through harmonious music, evoking a sense of nostalgia.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  },
  {
    "name": "พลองไม้สั้น",
    "nameEn": "Phlong Mai San (Wooden Staff-Truncheon Demonstration)",
    "descriptionEn": "Phlong Mai San is an ancient Thai traditional martial arts technique. Phlong is a long wooden staff, while Mai San is a short wooden truncheon that is equipped on the forearms. Demonstrations of Phlong Mai San skills is often done with a pair of fighters, one wielding the Phlong and one wielding the Mai San. Red and blue attires are also used to mark each side. The demonstrators are required to pass basic training of offensive and defensive movements before moving on to advance tactics in order to ensure perfection of the choreography. During the demonstration, the Mai San wielder often display agility through advancing towards the Phlong wielder .",
    "categoryGroupEn": "Central Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "มวยคาดเชือก",
    "nameEn": "Muay Khat Chueak (Thai Ancient Boxing Demonstration)",
    "descriptionEn": "Muay Khat Chueak is a form of ancient, unarmed traditional Thai martial arts whereby fighters wrap their hands and forearms in hemp ropes. This traditional martial art utilizes a combination fist, leg, knee, and elbow movements. It is a precursor to the modern form of MuayThai. Muay Khat Chueak demonstrations aim to showcase the offensive and defensive tactics of fighters. Thus, performers must undergo basic training to develop their combat and performing skills.",
    "categoryGroupEn": "Central Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำชาวนา",
    "nameEn": "Rabam Chao Na (Farmers’ Dance)",
    "descriptionEn": "Rabam Chao Na is a dance inspired by the way of life of Thai farmers. Male and female dancers act out different aspects of rice farming through choreography, including ploughing, sowing, and harvesting.",
    "categoryGroupEn": "Central Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำเถิดเทิง",
    "nameEn": "Ram Thoet Thoeng (Long Drum Dance)",
    "descriptionEn": "Ram Thoet Thoeng, also known as Ram Klong Yao, is a playful dance between men and women that features the long drum as the main prop of the performance. Klong Yao is the name of traditional Thai long drum. The instrument is often played during festive occasions. In Ram Thoet Thoeng, male dancers beat the long drums in cheerful rhythms while dancing alongside female dancers, each taking turn to tease the other side with different dance moves.",
    "categoryGroupEn": "Central Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำวงมาตรฐาน",
    "nameEn": "Ram Wong Mat-tra-than (Thai Standard Circle Dance)",
    "descriptionEn": "Ram Wong Mat-tra-than is the standardized version of the Ram Wong: Thai circle dance. The dance was developed from the Ram Thone dance: a circle dance where the Thone (Thai goblet drum) is used as the main rhythm instrument. Ram Wong is usually performed during annual festive celebrations of the Central Thai people. The choreography is determined by the ten standard songs, including Ngam Saeng Duan (Beautiful Moonlight), Chao Thai (Thai People), Ram Si Ma Ram (Come Dance!), Khuen Duean Ngai (Moonlit Night), Duang Chan Wan Phen (Full Moon), Dok Mai Khong Chat (Flower of the Nation), Duang Chan Khwan Fa (Moon of the Sky), Ying Thai Chai Ngam (Thai Ladies, Beautiful Hearts), Bu Cha Nak Rop (Praising Warriors), and Yot Chai Chai Han (Great Brave Men).",
    "categoryGroupEn": "Central Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำสีนวล",
    "nameEn": "Ram Si Nuan (Thai Lady Dance)",
    "descriptionEn": "Ram Si Nuan is a dance known for its exceptionally graceful choreography and accompanying lyrical music. The purpose of this performance is to reflect the beauty of Thai women through dance and music. Ram Si Nuan can be performed on general occasions.",
    "categoryGroupEn": "Central Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "โนรา",
    "nameEn": "Nora",
    "descriptionEn": "Nora is a folk performing art from Southern Thailand, with a history that dates back several hundred years. It is a comprehensive artform involving dance, acting, singing, poetry, costume craftsmanship, and spiritual elements. Its powerful choreography is inspired the mythical Kinnari, half-bird half-human creatures found in Indian and Thai literatures. Nora can be performed as entertainment or featured in rituals to pay respect to deceased Nora masters. In 2021, the United Nations Educational, Scientific, and Cultural Organization (UNESCO) included Nora in the List of Intangible Cultural Heritage.",
    "categoryGroupEn": "Southern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รองเง็ง",
    "nameEn": "Ronggeng",
    "descriptionEn": "Ronggeng is a type of performing arts found in maritime Southeast Asia. For ethnic Malay communities in Thailand, Ronggeng refers to a type of dance between men and women. The dancers dance without touching each other in order to keep with Islamic norms. The dance and its music have been influenced by Western cultures, particularly Spain and Portugal, who came to trade with communities across what is now Thailand’s Southern border provinces. The music used is a combination of Malay songs and instruments with Western instruments, such as the violin.",
    "categoryGroupEn": "Southern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำตารีกีปัส",
    "nameEn": "Rabam Tari Kipas (Southern Fan Dance)",
    "descriptionEn": "Rabam Tari Kipas is a fan dance from Southern Thailand. The name Tari Kipas comes from the Malay terms “Tari” (meaning dance) and “Kipas” (meaning fan). Performers holding folding fans in both hands dance to music played by a mixture of local and Western musical instruments.",
    "categoryGroupEn": "Southern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำตารีบุหงา",
    "nameEn": "Rabam Tari Bu-nga (The Southern Bouquet Dance)",
    "descriptionEn": "The name Tari Bunga comes from the Malay terms “Tari” (meaning dance) and “Bu-nga” (meaning flowers). The dance was inspired by a type of flower bouquet that is given to guests during the wedding ceremonies of ethnic Malay communities in Southern Thailand. The performers, dressed in traditional Southern attire, each holds a bouquet of flowers placed in a pedestal tray while dancing to traditional Southern music.",
    "categoryGroupEn": "Southern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำร่อนแร่",
    "nameEn": "Rabam Ron Rae (Mineral-Sifting Dance)",
    "descriptionEn": "Rabam Ron Rae is a dance from Southern Thailand, with a choreography depicting mining-related activities such as sifting, selecting, and collecting minerals near water sources. The movements of the dance are performed in synchronization with joyful rhythmic music. Southern Thailand is rich in natural resources and is a popular region for mining activities.",
    "categoryGroupEn": "Southern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "กลองสะบัดชัย",
    "nameEn": "Klong Sa-bat Chai (The Victory Drum)",
    "descriptionEn": "The dance of Klong Sa-bat Chai, or Victory Drum, is a traditional performing art of the Northern Thai People, also known as the Lan Na people. The Victory Drum is a type of large drum that was traditionally used during wartime to uplift the spirit of soldiers. It was later adopted into religious ceremonies, processions, and other occasions as a symbol of peace and prosperity. The main performer of the dance stands in front of the drum and uses martial art movements to strike the drum with different parts of the body. The movements require great skills and vigour .",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนจันทราพาฝัน",
    "nameEn": "Fon Chanthra Pha Fan (Dreamy Moonlight Dance)",
    "descriptionEn": "Fon Chanthra Pha Fan is an expressive Northern Thai folk dance depicting the dreamlike reverie of northern maidens enchanted by the ethereal radiance of the moon, characterized by gentle, flowing choreography.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนเจิง",
    "nameEn": "Fon Jerng (Northern Martial Art Dance)",
    "descriptionEn": "Fon Jerng is a combination of “Fon” (Northern Thai dancing) and “Jerng” (the martial art of Northern Thai people). Performances often involve displays of martial arts movements and hand-to-hand combat skills, but can also involve use of weapons such as swords and spears.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนดวงเดือน",
    "nameEn": "Fon Duang Duean (Moonlight Dance)",
    "descriptionEn": "Fon Duang Duean is a romantic Northern Thai dance performed to the classic composition Lao Duang Duean composed by Prince Benbadhanabongse, expressing affectionate courtship under the moonlight with gentle northern dance idioms.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนที",
    "nameEn": "Fon Thi (Umbrella Dance)",
    "descriptionEn": "“Thi” is the local Tai word for “umbrella”, which is used as the main prop for this dance. Fon Thi is derived from the beauty of traditional umbrella, combined with traditional dancing style of the Tai people in Mae Hong Son Province in Northern Thailand. It focuses on displaying umbrella movements in synchronization with local music.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนเทียน",
    "nameEn": "Fon Thian (Candle Dance)",
    "descriptionEn": "Fon Thian is a dance from Northern Thailand, with female performers holding a candlestick in each hand and dancing along to local music. This dance is commonly performed during nighttime, so as to highlight the candlelight’s movements.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนผาง",
    "nameEn": "Fon Phang (Eathen Lamp Dance)",
    "descriptionEn": "Fon Phang is a dance of the Lan Na people of Northern Thailand. The performers dance with “Phang Pratheep” (ignited earthenware lamps) in both hands. “Phang” is the local word for a type of earthenware lamp, and “Pratheep” is the word for light. This performance has been featured in important festivals and ceremonies of the Northern Thai people since ancient times.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนมาลัย",
    "nameEn": "Fon Malai (Garland Dance)",
    "descriptionEn": "Fon Malai, also known as Fon Duang Dok Mai, is an elegant court dance of the Chiang Mai royal court patronized by Princess Dara Rasmi, featuring dancers stringing and offering scented flower garlands in welcoming veneration.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนรัก",
    "nameEn": "Fon Rak (Dance of Love)",
    "descriptionEn": "Fon Rak is a tender, lyrical dance from the Lakhon Phanthang drama Phra Lo (scene: Phra Lo in the Garden) composed by Prince Narathip Praphanphong, portraying youthful affection and poetic romance in northern royal courts.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนเล็บ",
    "nameEn": "Fon Leb (Fingernails Dance)",
    "descriptionEn": "Fon Leb is a dance from Northern Thailand that is occasionally performed to welcome guests. Performers adorn themselves with golden artificial fingernails and dance along to local music. Their delicate, slow-paced choreography and graceful hand movements are accentuated by their long fingernails.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนสาวไหม",
    "nameEn": "Fon Sao Mai (Silk Reeling Dance)",
    "descriptionEn": "Fon Sao Mai is a dance whose choreography is inspired by the movements of silk production. The dance begins by mimicking the movement of growing mulberry leaves (which are used to feed silkworms), followed by cocoon harvesting, silk thread reeling, and concluding with silk weaving. This dance is commonly accompanied by slow-beat music from traditional Northern Thai instruments, such as Salo (spiked fiddle with three strings) and Sueng (plucked fretted lute).",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำเก็บใบชา",
    "nameEn": "Rabam Kep Bai Cha (Tea Leaves Harvesting Dance).",
    "descriptionEn": "Rabam Kep Bai Cha is a dance inspired by the tea harvesting activities of hill tribe people in Northern Thailand. The dance depicts harvesters going out into the fields in early morning to collect tea leaves. The fresh leaves are then selected for quality and dried into tea. This dance is often performed while harvesters wait for the tea leaves to dry in the evening. Performers dress in the traditional clothing of the Northern hill tribe people.",
    "categoryGroupEn": "Northern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "กระทบสากหรือกระทบไม้",
    "nameEn": "Krathop Saak Krathop Mai (Pestle-Wooden Rod Percussion Dance)",
    "descriptionEn": "The Krathop Saak Krathop Mai dance is a folk game of the people in Surin Province, Lower Northeastern Thailand. The dance was originally called Ten Saak or “Pestle Dance”. This dance game was born out of the jolly nature of the Thai people, who decided to make creative use of a household item – the wooden pestle – in their spare time from farming activities. Large wooden pestles are normally used to pound and separated rice grains from the husks. The locals used crossed pairs of these pestles as giant ground-level clappers, producing rhythm and challenging others to dance between the fluctuating gaps. The pestles can also be replaced with other forms of long wooden rods, such as bamboo, hence the name Krathop Saak Krathop Mai or “Pestle-Wooden Rod Percussion Dance.”",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "เซิ้งกระติบข้าว",
    "nameEn": "Soeng Kratip Khao (Sticky Rice Basket Dance)",
    "descriptionEn": "Soeng Kra-tip Khao is a folk dance of the Phu Thai ethnic group that is performed during holiday celebrations. The word “Kratip” refers to a type basket container used primarily to hold cooked glutinous rice. The performance portrays young women delivering a meal to their loved ones who are working outside the house. The dance focuses on displaying the beauty of bodily movements, both slow and fast.",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "เซิ้งตังหวาย",
    "nameEn": "Soeng Tang-Wai (Tang Wai Dance)",
    "descriptionEn": "Soeng Tang Wai is a folk dance found in communities across both the Thai and Lao sides of the Mekong River . The performance begins with folk singing accompanied by instrumentations, followed by a dance to the Lam Tang Wai tune. This piece of music is popularly played across both sides of the Mekong River and is often used as the melody for songs in many kinds of performances.",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "เซิ้งไทภูเขา",
    "nameEn": "Soeng Thai Phu Khao (Thai Mountain Tribe Dance)",
    "descriptionEn": "Soeng Thai Phu Khao is a dance inspired by the lifestyle of Phu Thai communities residing along the Phu Phan Mountain Range. The dance depicts a scene of Phu Thai people venturing into the mountains to collect rattan wood and harvest food, such as bamboo shoots, Ya Nang leaves, mushrooms, and other vegetables. After they are done foraging, the people pay respect to the guardian spirits of the mountain before returning home.",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "เซิ้งโปงลาง",
    "nameEn": "Soeng Pong Lang (I-san Xylophone Dance)",
    "descriptionEn": "Soeng Pong Lang is a dance of young men and women, performed after the end of daily work and duties. The mood of the dance is joyful, with a dash of playfulness between the opposite sexes. The dancers move to the melodies of the Pong Lang: a type of wooden xylophone that originated from the I-san Region.",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "เซิ้งสวิง",
    "nameEn": "Soeng Sa-wing (Landing Net Dance)",
    "descriptionEn": "Soeng Sa-wing is a folk dance of Northeastern Thailand that depicts the act of fishery. The Sa-wing (landing net), a fishing device, has been adapted as the main prop of this performance. The dance consists of men and woman dancing to upbeat music, mimicking different acts of fishing. The beauty of this dance lies in the creative ability to convey fishing movements through graceful gestures. The dance also contains an element of playfulness between male and female dancers.",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนภูไท",
    "nameEn": "Fon Phu-Thai (Phu Thai Dance)",
    "descriptionEn": "Fon Phu-Thai is the dance form of the Phu-Tai people, who reside in communities along the Mekong River and Phu Phan Mountain Range, including Nakhon Phanom, Sakon Nakhon, Kalasin and Mukdahan Provinces. The dance is usually performed during holiday celebrations, with choreography being passed down through generations. The dancers wear long artificial fingernails tipped with red-coloured tufts in order the highlight the beauty of hand movements.",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนภูไท 3 เผ่า",
    "nameEn": "Fon Phu Thai Sam Phao (The Three Phu Thai Dance)",
    "descriptionEn": "Fon Phu Thai Sam Phao is a performance that combines the dances of three Phu Thai communities residing across the Phu Phan Mountain Range: the Kalasin, Sakon Nakhon and Nakhon Phanom communities. Originally, both male and female dancers performed in this dance, with elements of martials arts and courtship interwoven into the performance. Later on, however , a variation of the dance with all-female dancers became more popular .",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฟ้อนหมากกั๊บแก๊บลำเพลิน",
    "nameEn": "Fon Maak Gup-Gap Lam Phloen (The I-san Wooden Percussions Duet Dance)",
    "descriptionEn": "Fon Maak Gup-Gap Lam Phloen is the combination of two folk performances: Fon Maak Gup-Gap and Lam Phloen. Maak Gup-Gap is a traditional percussion instrument of the I-san Region. There are two types of Maak Gup-Gap: (1) short wooden clappers with smooth surface and (2) long wooden clappers with jagged surface. These instruments can be played in any occasion that requires musical accompaniments, such as festivals and celebrations. The dance that utilizes Maak Gup-Gap as a prop is known as Fon Maak Gup-Gap and is performed by male dancers. Lam Phloen, on the other hand, is a style of folk singing of the I-san people. Fon Maak Gup-Gap Lam Phloen combines the two performances, with the male dancer representing the Fon Maak Gup-Gap aspect and the female dancer representing the Lam Phloen aspect. The dance is a joyful performance, reflecting a playful scene between man and woman.",
    "categoryGroupEn": "Northeastern Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "กราววีรชัยยักษ์",
    "nameEn": "Grao Weerachai Yak (Dance of the Demon Troop)",
    "descriptionEn": "Grao Weerachai Yak is a dance fashioned in the Khon style that depicts the assembly of demon army generals. The dance style represents power , unity, and grace. The dance choreography was adapted from a scene in the Khon play when the demon army of Longka is undergoing troop inspection.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "กราววีรชัยลิง",
    "nameEn": "Grao Weerachai Ling (Dance of the Monkey Troop)",
    "descriptionEn": "Grao Weerachai Ling is a dance fashioned in the Khon style that depicts the assembly of monkey army generals. These generals were collectively known as the Sibpaed Mongkut, or the 18 Crowns, and were made up off 18 elite monkey warriors. The dance style is agile, swift, and powerful. The dance choreography was adapted from a scene from the Khon play when the monkey army of Phra Ram (Rama) is undergoing troop inspection. The choreography was also inspired by the naturally playful movements of monkeys.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ชุดยกรบ",
    "nameEn": "Khon Masked Dance (The Ramakien): Scene of the Great Battle (Yok Rop)",
    "descriptionEn": "A climactic battle scene from the Khon performance of the Ramakien depicting the clash between the armies of Prince Rama and the demon king Ravana, showcasing high-level acrobatic combat postures and martial formations.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน จองถนน",
    "nameEn": "Khon Masked Dance (The Ramakien): Building the Causeway to Lanka",
    "descriptionEn": "Episode depicting the construction of the stone causeway across the ocean to Lanka by Rama's monkey army, featuring Hanuman's leadership in commanding the forces to bridge the sea despite marine obstacles.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน นารายณ์ปราบนนทก",
    "nameEn": "Khon Masked Dance (The Ramakien): Narayana Subdues Nontok",
    "descriptionEn": "Episode narrating the origin of the epic conflict, where the deity Narayana transforms into a captivating celestial maiden to trick the arrogant demon Nontok into using his diamond finger against himself.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน ศึกแสงอาทิตย์",
    "nameEn": "Khon Masked Dance (The Ramakien): The Battle of Saeng-athit",
    "descriptionEn": "Episode portraying the fierce battlefield clash between Rama's forces and Saeng-athit, nephew of Ravana who wields the devastating Glass Reflector (Surya Glass), thwarted by Hanuman's clever tactics.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน หนุมานชาญสมร",
    "nameEn": "Khon Masked Dance (The Ramakien): The Valorous Hanuman",
    "descriptionEn": "Episode highlighting the acrobatic prowess, cunning intelligence, and loyal martial deeds of the white monkey warrior Hanuman across his legendary exploits in the Ramakien.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน กุมภกรรณพุ่งหอกโมกขศักดิ์",
    "nameEn": "Khon Masked Dance (The Ramakien): Kumbhakarna Hurling the Mokkhasak Spear",
    "descriptionEn": "Episode depicting Kumbhakarna, brother of Ravana, entering the fray and hurling the deadly, consecrated divine spear Mokkhasak to strike Prince Lakshmana on the battlefield.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน ขับพิเภก",
    "nameEn": "Khon Masked Dance (The Ramakien): The Banishment of Bibhek (Phiphek)",
    "descriptionEn": "Episode depicting Ravana angrily exiling his righteous brother Bibhek from Lanka after Bibhek prophetically advises him to return Sita to Rama, leading Bibhek to ally with Rama's righteous camp.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน นางลอย",
    "nameEn": "Khon Masked Dance (The Ramakien): The Floating Lady (Nang Loi)",
    "descriptionEn": "Episode recounting Ravana's scheme ordering his niece Benyakai to transform into the corpse of Sita and float upriver to Rama's camp, unmasked when Hanuman subjects the body to a trial by fire.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน พระคเณศเสียงา",
    "nameEn": "Khon Masked Dance (The Ramakien): Ganesha Losing His Tusk",
    "descriptionEn": "Episode dramatizing the mythical confrontation between Parashurama (Axe-wielding hero) and Lord Ganesha guarding Mount Kailash, culminating in Ganesha sacrificing one tusk out of devotion to Shiva's axe.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน พระรามตามกวาง",
    "nameEn": "Khon Masked Dance (The Ramakien): Rama Chasing the Golden Deer",
    "descriptionEn": "Episode depicting the demon Maricha disguised as an alluring golden deer to lure Prince Rama away from their hermitage, setting the stage for Ravana's deceitful abduction of Sita.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน พาลีสอนน้อง",
    "nameEn": "Khon Masked Dance (The Ramakien): Vali Teaching His Brother (Phali Son Nong)",
    "descriptionEn": "Episode recounting the dying moments of Vali, ruler of Kishkindha, imparting profound royal counsel and ethical duty to his younger brother Sugriva regarding faithful servitude to Prince Rama.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน ลักสีดา",
    "nameEn": "Khon Masked Dance (The Ramakien): The Abduction of Sita",
    "descriptionEn": "Episode depicting Ravana disguising himself as a mendicant ascetic to abduct Princess Sita from her forest sanctuary into his aerial chariot, triggering the heroic rescue attempt by the bird king Jatayu.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน ศึกพรหมาสตร์",
    "nameEn": "Khon Masked Dance (The Ramakien): The Battle of the Brahmastra",
    "descriptionEn": "Episode dramatizing Indrajit disguising his demon troops as Lord Indra's celestial procession to distract Lakshmana's army before discharging the invincible celestial arrow Brahmastra.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน ศึกวิรุญจำบัง",
    "nameEn": "Khon Masked Dance (The Ramakien): The Battle of Wirun Chambang",
    "descriptionEn": "Episode narrating the battle against Wirun Chambang, who possesses invisibility powers and hides within ocean foam, pursued and vanquished through Hanuman's relentless underwater pursuit.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน ศึกวิรุญมุข",
    "nameEn": "Khon Masked Dance (The Ramakien): The Battle of Wirun Muk",
    "descriptionEn": "Episode depicting the fierce engagement of Prince Wirun Muk leading demon cohorts onto the battlefield with high-energy combat acrobatics and classical Khon weaponry choreography.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน ศึกสัทธาสูร",
    "nameEn": "Khon Masked Dance (The Ramakien): The Battle of Satthasur",
    "descriptionEn": "Episode depicting the confrontation against demon chieftain Satthasur, who seeks celestial weapons through prayer, foiled by Hanuman's strategic deception and battle maneuvers.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน สามจับ",
    "nameEn": "Khon Masked Dance (The Ramakien): Sam Chap (The Three Captures)",
    "descriptionEn": "Episode depicting Kumbhakarna's trick enticing Sugriva to uproot the giant Rang tree, leading to an intense three-phase wrestling struggle demonstrating master Khon ape and demon martial postures.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "การแสดงโขนเรื่องรามเกียรติ์ ตอน สุครีพถอนต้นรัง",
    "nameEn": "Khon Masked Dance (The Ramakien): Sugriva Uprooting the Rang Tree",
    "descriptionEn": "Episode depicting the mighty monkey general Sugriva displaying superhuman strength to uproot a colossal Rang tree to accept Kumbhakarna's challenge and test of valor.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "กินนรีร่อนออกมโนราห์บูชายัญ",
    "nameEn": "Nora",
    "descriptionEn": "Nora is a folk performing art from Southern Thailand, with a history that dates back several hundred years. It is a comprehensive artform involving dance, acting, singing, poetry, costume craftsmanship, and spiritual elements. Its powerful choreography is inspired the mythical Kinnari, half-bird half-human creatures found in Indian and Thai literatures. Nora can be performed as entertainment or featured in rituals to pay respect to deceased Nora masters. In 2021, the United Nations Educational, Scientific, and Cultural Organization (UNESCO) included Nora in the List of Intangible Cultural Heritage.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "เมขลา รามสูร",
    "nameEn": "Mekhala Ramasoon",
    "descriptionEn": "The dance portrays the chase between two characters from ancient Thai folklore: Ramasoon and Mekhala. Mekhala, a goddess who looks after seafarers, left her abode to join a dance with other celestial beings during the rainy season. She tossed her magical crystal ball into the air to create beautiful rays of light. Ramasoon, the demon god, flew by and spotted the brilliant rays. He then began chasing Mekhala to try to steal the magical crystal ball. As Mekhala escapes, she flickers the shinning orb to tease Ramasoon.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รจนาเสี่ยงพวงมาลัย",
    "nameEn": "Rotjana Siang Phuang Malai (Princess Rotjana's Choice of Groom)",
    "descriptionEn": "A classic scene from the Lakhon dance-drama Sang Thong, where Princess Rotjana discerns the hidden golden divinity within the ugly Chao Ngo (Sangkha) and tosses her auspicious floral garland to choose him.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Khon Masked Dance & Lakhon Dance Drama"
  },
  {
    "name": "ระบำกรับ",
    "nameEn": "Rabam Krap (A Hand-clapper Dance)",
    "descriptionEn": "Rabam Krap is a dance featuring the Thai traditional musical instrument known as Krap Phuang (layered hand clappers). Performers hold the Krap Phuang in the right hand and create sound by clapping it against different parts of their body, such as palms, shoulders, and thighs. The dance employs both fast-paced and slow-paced music.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำกฤดาภินิหาร",
    "nameEn": "Krit-da Phinihan",
    "descriptionEn": "The Krit-da Phinihan dance is a part of the historical play Kiattisak Thai (Thai Glory). performers dress in the standard male and female protagonist costumes, representing heavenly beings. Each holds a tray full of flowers and scatters them to bless the performance and audience. This show can be performed in various ceremonies to bring good fortune.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำกินรีร่อน",
    "nameEn": "Kinnari Ron (Hovering Kinnari Dance)",
    "descriptionEn": "Kinnari Ron is a dance depicting the Kinnari, a woman-like mythological creature with wings and tail of a bird. The scene portrays the Kinnari flying down from Mount Kailash to dabble in Lake Anotatta. This delicate and graceful dance is accompanied by cheerful music.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำฉิ่ง",
    "nameEn": "Rabam Ching (Cup Cymbals Dance)",
    "descriptionEn": "Rabam Ching is a dance featuring the traditional Thai percussion instrument Ching (a pair of small cup cymbals). This instrument regulates the tempo of Thai traditional music and is featured in all types of traditional ensemble. Performers dance while holding Ching in both hands, clapping it to make three distinct sounds: “Ching” (produced by striking the edge of the cups against each other), “Chap” (produced by clasping the cups), and “Rua Ching” (quivering sound). The dance is accompanied by fast-paced and slow-paced music.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำชุดไทยพระราชนิยม",
    "nameEn": "Rabam Chut Thai Phraratchaniyom (Royal Thai National Costumes Dance)",
    "descriptionEn": "Rabam Chut Thai Phraratchaniyom is a dance inspired by the standard national Thai traditional dress for women. These dresses were created by Her Majesty Queen Sirikit, the Queen Mother . The names of the dresses are Ruean Ton, Chitlada, Amarin, Borom Phiman, Chakri, Dusit, Chakkraphat, and Siwalai. The choreography and accompanying lyrical music are aimed toward promoting the use and conservation of these eight national dresses.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำดาวดึงส์",
    "nameEn": "Rabam Dao-wa-dueng (Dance of Trayastrimsa)",
    "descriptionEn": "Rabam Dao-wa-dueng is a dance from the Lakhon Deukdamban play Sang Thong (Goden Conch). Performers dress in the standard male and female protagonist costumes, representing heavenly beings. The name “Dao-wa-dueng” comes from the Thai pronunciation of “Trayastrimsa”: the second level of heaven in Buddhist mythology. This beautiful dance describes the celestial abodes of Trayastrimsa where the god Indra resides.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำเทพบันเทิง",
    "nameEn": "Rabam Thep Ban-thoeng (Dance of the Delighting Deities)",
    "descriptionEn": "Rabam Thep Ban-thoeng is a dance from the Lakhon Nai play Inao. performers dress in the standard male and female protagonist costumes, representing heavenly beings who dance gracefully to entertain the revered god Petarakala. This show can be performed in various ceremonies for good fortune.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำนพรัตน์",
    "nameEn": "Rabam Noppharat (Dance of the Nine Gems)",
    "descriptionEn": "Rabam Noppharat is a dance representing the Navaratna, a set of nine gems from Hindue beliefs that are said to enhance the fortune of its owners. The nine gems include: diamond, ruby, emerald, topaz, garnet, black spinel, pearl, zircon, and chrysoberyl. The dance employs nine performers, each dressed in a distinct colour representing each of the nine gems.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำพรหมาสตร์",
    "nameEn": "Rabam Phrommasat (The Brahmastra Celestial Dance)",
    "descriptionEn": "An overture dance performed by celestial apsaras and devas preceding the Khon episode Battle of the Brahmastra, depicting heavenly celebration before Indrajit's deceptive arrival.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำย่องหงิด",
    "nameEn": "Rabam Yong-ngit (Classical Royal Courtiers Dance)",
    "descriptionEn": "A refined royal court dance from the Lakhon Nai drama Unarut (scene: Suphalak Painting the Portrait), known for its elegant, dainty hand movements and intricate rhythmic footwork.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำวิชนี",
    "nameEn": "Rabam Wichani (Wichani Dance)",
    "descriptionEn": "Rabam Wichani is a dance featuring the Wichani, a type of fan used primarily in the royal court. The dance was inspired by the Thai people’s use of hand fans to relieve themselves from the country’s hot weather . It is performed by young woman dressed in Thai royal court costume, holding a Wichani fan in their right hand.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำศรีชยสิงห์",
    "nameEn": "Rabam Si Chai-ya-sing (Sri Jaiyasingh Dance)",
    "descriptionEn": "Rabam Si Chai-ya-sing is a dance inspired by the Bayon-style mural engravings of Apsaras (celestial maidens) at the Prasat Mueang Sing, a historical temple located on the banks of Khwae Noi River in Kanchanaburi Province. According to inscriptions dating back to the reign of the King Jayavarman VII of the Angkor Empire found at the Preah Khan Temple in Cambodia, the area consisted of a cultural mixture between the Mon, Khmer , and Thai peoples.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำซัดชาตรี",
    "nameEn": "Sat Chatri",
    "descriptionEn": "Sat Chatri is an overture dance in the form of a male and female duet, with fast-paced music and movements. It is derived from the Sat Wai Khru Dance, which is performed to pay respect to teachers and deceased masters of the Lakhon Chatri dance-drama.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำเบิกโรงดอกไม้เงินทอง",
    "nameEn": "Ram Boek Rong Dok Mai Ngoen Thong (Silver and Gold Flowers Overture Dance)",
    "descriptionEn": "Ram Boek Rong Dok Mai Ngoen Thong is an overture dance of the Lakhon Nai dance drama. It was created by the order of King Mongkut the Great (Rama IV) to be an alternative to old Lakhon overture dances. The dance employs two performers dressed in standard male protagonist costumes, holding a golden flower bouquet in their right hands and a silver flower bouquet in their left hands. The performers dance to auspicious music and lyrics in order to bless the ensuing Lakhon Nai performance and wish happiness for the audience.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำประเลง",
    "nameEn": "Ram Praleng (Sacred Purification Overture Dance)",
    "descriptionEn": "An ancient overture dance performed before classical Lakhon Nai performances to dispel obstacles, purify the stage with sacred peacock feathers, and invoke celestial blessing for the troupe and audience.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำฝรั่งคู่",
    "nameEn": "Ram Farang Khu (Farang Duo Dance)",
    "descriptionEn": "Ram Farang Khu is a duo dance accompanied by the songs Farang Ram Thao, Takhoeng, Chao Sen, Phleng Rew, Phleng Ching, Chin Rua, Chin Ram Phat, and Chin Thon. The costumes used are that of the standard male and female protagonist attires. During the last part of the show, performers dance with folding fans in both hands.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำพลายชุมพล",
    "nameEn": "Ram Phlai Chumphon (Phlai Chumphon Martial Dance)",
    "descriptionEn": "A dynamic solo dance from the Lakhon Sepha epic Khun Chang Khun Phaen, portraying young warrior Phlai Chumphon disguising himself as a Mon commander and demonstrating Mon-Thai martial prowess.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำมโนห์ราบูชายัญ",
    "nameEn": "Manora Bucha-yan (Sacrificial Dance of Manora)",
    "descriptionEn": "Manora Bucha-yan is a solo dance of Manora, a Kinnari and main character of the tale of Phra Suthon Manora. When Monora’s husband, Prince Suthon, was away, she was accused of bringing bad luck to the kingdom and was sentenced to be burned alive as an offering to the gods. Manora cleverly feigned acceptance and asked for her confiscated wings to be returned, so that she may perform a votive dance before jumping into the sacrificial pyre. The Manora Bucha-yan dance depicts the scene of Manora dancing, displaying great beauty as well as agility. The performance ends with Manora flying off to Mount Kailash, home of the Kinnaris, in order to escape her death.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "รำแม่บท",
    "nameEn": "Ram Mae Bot (Dance of the Principal Movements)",
    "descriptionEn": "Ram Mae Bot is the standard dance used for practicing principal movements in Thai classical dance. Thus, Ram Mae Bot is the basis used for creating choreographies for various other performances. The names of all the dance movements are recited in a song that accompanies this dance. Performers dress in the standard male and female protagonist costumes.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "หนุมานจับนางเบญกาย",
    "nameEn": "Hanuman Chap Nang Benyakai (Hanuman Chases Benyakai)",
    "descriptionEn": "Hanuman Chap Nang Benyakai is a duo dance from the Khon performance, featuring the characters Hanuman and Benyakai (Trijata). The dance came from an episode in the Ramakien when, following the demon king Thotsakan’s (Ravana) plan to trick Phra Ram (Rama), the demoness Benyakai transformed herself into Sida (Sita) and feigned death by floating down a river . To prove her identity, “Sida’s” corpse was burned on a pyre. Unable to withstand the fiery heat, Benyakai transformed back into herself and tried to flee. Hanuman, Phra Ram’s trusty monkey general, chased after Benyakai and caught her in time. During the chase, however , Hanuman became enamoured with Benyakai’s beauty and began to court her . The choreography combines movements of pursuit and dalliance.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "หนุมานจับนางสุพรรณมัจฉา",
    "nameEn": "Hanuman Chap Nang Suphannamatcha (Hanuman Chases Suphannamatcha)",
    "descriptionEn": "Hanuman Chap Nang Suphannamatcha is a duo dance from the Khon performance, featuring the characters Hanuman and Suphannamatcha. The dance came from an episode in the Ramakien when Phra Ram (Rama), was building a causeway across the ocean to rescue his wife Sida (Sita), who was abducted by the demon king Thotsakan (Ravana). To thwart Phra Ram’s plan, Thotsakan sent his mermaid daughter Suphannamatcha, whom he had conceived with a fish, to lead an army of sea creatures in destroying the causeway. Hanuman, Phra Ram’s trusty monkey general, intercepted the plan and began chasing Suphannamatcha. During the chase, however , Hanuman became enamoured with Suphannamatcha’s beauty and began to court her . The Hanuman Chap Nang Suphannamatcha portrays the chasing and courting of Hanuman and Suphannamatcha. The choreography combines movements of pursuit and dalliance.",
    "categoryGroupEn": "Classical Performing Arts",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำเชียงแสน",
    "nameEn": "Rabam Chiang Saen (Chiang Saen Dance)",
    "descriptionEn": "Rabam Chiang Saen is one of the Five Archaeological Dances. It is inspired by mural paintings and reliefs found in archaeological sites from the ancient Chiang Saen Kingdom (16 th-23rd century B.E.). The choreography and music of this performance combine Northern and Northeastern Thai traditional dance and music styles.",
    "categoryGroupEn": "Archaeological Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำทวารวดี",
    "nameEn": "Rabam Thawarawadi (Dvaravati Dance)",
    "descriptionEn": "Rabam Thawarawadi is one of the Five Archaeological Dances. It is inspired by artifacts, mural paintings, and sculptures from the Dvaravati Kingdom (12 th-16th century B.E). The dance choreography, music, and costumes were designed based on dance, music, and clothing if the Mon people, who were the natives of the Dvaravati Kingdom.",
    "categoryGroupEn": "Archaeological Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำลพบุรี",
    "nameEn": "Rabam Lopburi (Lopburi Dance)",
    "descriptionEn": "Rabam Lopburi is one of the Five Archaeological Dances. It is inspired by the Khmer-style sculptures and engravings found on lintels and tympana at Prasat Hin Phimai Archaeological site in Nakhon Ratchasima Province and Prasat Phanom Rung Archaeological site in Buriram Province. These sites were part of the Lopburi (Lavo) Kingdom (12 th-13th century B.E), which was situated in the area of present-day Northeastern Thailand. The dance choreography, music, and costumes are based on the culture of this ancient kingdom.",
    "categoryGroupEn": "Archaeological Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำศรีวิชัย",
    "nameEn": "Rabam Siwichai (Srivijaya Dance)",
    "descriptionEn": "Rabam Siwichai is one of the Five Archaeological Dances. It is inspired by the Srivijaya Empire (13th-18th century B.E.), which spanned across a large portion of Maritime Southeast Asia. In Thailand, the Srivijaya civilization had a significant presence in what is now Chumphon, Pattani, and Nakhon Si Thammarat Provinces. The choreography, music, and costume of this dance is are modeled after the aesthetic style of artworks and artifacts from the Srivijaya period.",
    "categoryGroupEn": "Archaeological Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ระบำสุโขทัย",
    "nameEn": "Rabam Sukhothai (Sukhothai Dance)",
    "descriptionEn": "Rabam Sukhothai is one of the Five Archaeological Dances. It is inspired from the Leela attitude stucco Buddha statues and the bronze-cast Buddha images of the Sukhothai Kingdom (19 th-20th century B.E). The Leela attitude is a style of iconography that depicts the Buddha in graceful walking movement, as if gliding down from the heavens. Leela Buddha images from the Sukhothai period are revered for their exceptional beauty. The choreography, music, and costume of this dance is modelled after the culture of the Sukhothai Kingdom.",
    "categoryGroupEn": "Archaeological Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฉุยฉายทศกัณฐ์ลงสวน",
    "nameEn": "Chui Chai Thotsakan Long Suan (Chui Chai of Thotsakan Entering the Garden)",
    "descriptionEn": "Chui Chai Thotsakan Long Suan is a dance from the Khon performance. It is a solo dance of Thotsakan (Ravana), demon king of Langka and main antagonist of Ramakien. It depicts an episode from the story when Thotsakan attempts to court Sida (Sita), the female protagonist of the story. Thotsakan had previously abducted Sida from her husband, Phra Ram (Rama). Thotsakan then placed Sida in a beautiful garden and dressed himself in handsome attire, all in an attempt to win Sida’s affection. The dance portrays the scene of Thotsakan demonstrating pride in his grace and glory before heading to meet Sida in the garden. The dancer is dressed in an ogre costume with additional details, such as the inclusion of a red cape. The dancer wields a folding fan in his right hand, with a flower garland adorning his wrist.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฉุยฉายเบญกาย",
    "nameEn": "Chui Chai Benyakai (Chui Chai of Benyakai)",
    "descriptionEn": "Chui Chai Benyakai is a dance from the Khon performance. It is a solo dance of Benyakai (Trijata), an ogress and niece of Thotsakan (Ravana) from the story of Ramakien. Phra Ram (Rama), the main protagonist of the story, had raised an army of monkeys to retrieve his wife, Sida (Sita), whom Thotsakan had abducted. To trick Phra Ram into abandoning the quest, Thotsakan ordered Benyakai to transform into Sida, and feign death by floating down a river in front of Phra Ram’s army. The plan was to fool Phra Ram into thinking that Benyakai’s transformed body was the actual corpse of Sida. The Chui Chai Benyakai dance portrays a scene where, after having successfully transformed into the beautiful Sida, Benyakai dances to show pride in her grace and looks.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฉุยฉายพราหมณ์",
    "nameEn": "Chui Chai Phram (Chui Chai of the Brahmin)",
    "descriptionEn": "The Chui Chai Phram dance is a part of the overture dance of the play Phra Khanet Sia Nga, which tells the story of how the elephant-headed god Ganesha lost one of his tusks. This solo dance portrays the god Vishnu, after having transformed himself into a Brahmin priest, dancing elegantly to request blessings from the goddess Uma Devi (Parvati), the consort of the god Shiva.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฉุยฉายยอพระกลิ่น",
    "nameEn": "Chui Chai Yor Phra Klin (Chui Cahi of Yor Phra Klin)",
    "descriptionEn": "The Chui Chai Yor Phra Klin dance is a part of the Lakhon Nok play Manee Phichai. Yor Phra Klin is the name of the story’s female protagonist who possesses great beauty and a fragrant body scent. This solo dance portrays the scene of Yor Phra Klin dancing to show pride in her grace and beauty, before setting off to meet with Prince Manee Phichai, her husband and the male protagonist of the story.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฉุยฉายวันทอง",
    "nameEn": "Chui Chai Wan Thong (Chui Chai of Wan Thong)",
    "descriptionEn": "Chui Chai Wan Thong is a dance of Nang Wan Thong from the epic of Khun Chang Khun Phaen, which tells of the struggles between two noblemen: Khun Chang and Khun Phaen. Nang Wan Thong is one of the many wives of Khun Phaen, the story’s protagonist, and mother of Phra Wai, a commander in the Siamese army. After her demise, Wan Thong’s spirit lingers, looking over the safety of her son. The dance depicts the spirit Wan Thong transformed into a beautiful lady. She dances to display pride in her grace and beauty, before setting off to inform her son of the enemies’ plans.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฉุยฉายศูรปนขา",
    "nameEn": "Chui Chai Surapanakkha (Chui Chai of Shurpanakha)",
    "descriptionEn": "Chui Chai Surapanakkha is a dance from the Khon performance. It is a solo dance of Surapanakkha (Shurpanakha), an ogress and sister of Thotsakan (Ravana) from the story of Ramakien. Surapanakha became enamoured with Phra Ram (Rama), the main protagonist of the story, and his brother , Phra Lak (Lakshamana), after encountering them in the forest. To seduce Phra Lak and Phra Ram, Surapanakha transformed herself into a beautiful lady. The dance portrays Surapanakha, transformed into a maiden, dancing to show pride in her beauty and grace.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ฉุยฉายหนุมานทรงเครื่อง",
    "nameEn": "Chuai Chai Hanuman Song Khrueang (Chui Chai of Hanuman in Regal Attire)",
    "descriptionEn": "Chui Chai Hanuman is a dance from the Khon performance. It is the solo dance of Hanuman, the white-furred monkey general of Phra Ram (Rama), the protagonist of Ramakien. In an episode from this epic tale, Hanuman pretended to side with Thotsakhan (Ravana), the main antagonist of the story, in order to infiltrate the demon army and steal a box containing Thotsakhan’s heart. The dance portrays the scene of Hanuman dancing to display his pride and glory, before setting off to the final battle between Phra Ram and Thotsakhan. The term “Song Khrueang” roughly translates to “in regalia”. The costume of this dance is a combination of a monkey costume and a high-ranking ogre costume, reflecting Hanuman’s role as an espionage in the demon army. The mask depicts the face of Hanuman with the addition of a crown (Hanuman’s typical mask does not consist of a crown), while the clothing is that of a high-ranking ogre.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ชุมนุมฉุยฉาย",
    "nameEn": "Chum Num Chui Chai (The Assembly of Chui Chai Dances)",
    "descriptionEn": "Chum Num Chui Chai is an assembly of Chui Chai dances for five different character types: (1) male protagonist, (2) female protagonist, (3) Brahmin priests, (4) ogre, and (5) monkey. The costume and choreography for each of the dancers are specific to the character type that he/she is portraying. The characters dance together , each in their own style, to display pride in their own grace, elegance, and beauty.",
    "categoryGroupEn": "Chui Chai Classical Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "ดาบสองมือ",
    "nameEn": "Daab Song Mue (Double Hand Swords Demonstration)",
    "descriptionEn": "Daab Song Mue is an ancient Thai fighting technique where a fighter is armed with two swords; This technique requires a great amount of skill and concentration. The Daab (Thai style sword) is a type of curved, single-single edged sword. Double hand swords fighters must be able to use each sword to engage in the battle through aggressive and defensive moves. In a Daab Song Mue demonstration, fighters aim to showcase their offensive and defensive techniques.",
    "categoryGroupEn": "Central Thai Folk Dances",
    "performanceTypeEn": "Classical & Regional Dances (Rabam, Ram, Fon)"
  },
  {
    "name": "สุขสยาม",
    "nameEn": "Suk Siam (Joyous Siam)",
    "descriptionEn": "A creative celebratory performance presenting a vibrant tableau of peaceful prosperity, communal happiness, and rich regional cultural traditions flourishing across the realm of Siam.",
    "categoryGroupEn": "Creative Performing Arts",
    "performanceTypeEn": "Creative Contemporary Dance"
  }
];

export const KEYWORD_TRANSLATIONS: KeywordTranslation[] = [
  {
    "name": "กรมศิลปากร",
    "nameEn": "Fine Arts Department of Thailand"
  },
  {
    "name": "กระทบไม้",
    "nameEn": "Krathop Mai (Bamboo Clapping Percussion)"
  },
  {
    "name": "กระทุ้ง",
    "nameEn": "Krathung (Heel-Thrust Footwork)"
  },
  {
    "name": "กระบวนท่ารำ",
    "nameEn": "Dance Choreography / Postural Sequence"
  },
  {
    "name": "กรับพวง",
    "nameEn": "Krap Phuang (Strung Clapper Percussion)"
  },
  {
    "name": "กราบทูล",
    "nameEn": "Respectfully Addressing Royalty"
  },
  {
    "name": "กราววีรชัยลิง",
    "nameEn": "Grao Weerachai Ling (Monkey Troop Victory March)"
  },
  {
    "name": "กรุงรัตนโกสินทร์",
    "nameEn": "Rattanakosin Kingdom (Bangkok Era)"
  },
  {
    "name": "กรุงลงกา",
    "nameEn": "Krung Longka (City of Lanka / Demon Realm)"
  },
  {
    "name": "กรุงเทพ",
    "nameEn": "Bangkok"
  },
  {
    "name": "กรุงเทพมหานคร",
    "nameEn": "Bangkok Metropolis"
  },
  {
    "name": "กลองยาว",
    "nameEn": "Klong Yao (Long Drum)"
  },
  {
    "name": "กลองสะบัดชัย",
    "nameEn": "Klong Sa-bat Chai (Northern Victory Drum)"
  },
  {
    "name": "กลอุบาย",
    "nameEn": "Strategic Feint / Dramatic Ruse"
  },
  {
    "name": "กลับบ้าน",
    "nameEn": "Returning Home / Homecoming"
  },
  {
    "name": "กลางคืน",
    "nameEn": "Nocturnal / Nighttime"
  },
  {
    "name": "กลายร่าง",
    "nameEn": "Metamorphosis / Shape-Shifting"
  },
  {
    "name": "กลุ่มชาติพันธุ์",
    "nameEn": "Ethnic Communities / Ethnic Groups"
  },
  {
    "name": "กวางทอง",
    "nameEn": "Golden Deer (Disguise of Maricha)"
  },
  {
    "name": "กสิกรรม",
    "nameEn": "Agriculture & Crop Farming"
  },
  {
    "name": "กองทัพ",
    "nameEn": "Army / Military Host"
  },
  {
    "name": "กองไฟ",
    "nameEn": "Sacrificial Pyre / Bonfire"
  },
  {
    "name": "กะลา",
    "nameEn": "Coconut Shell (Kala)"
  },
  {
    "name": "กากนาสูร",
    "nameEn": "Kakanasur (Crow Demoness)"
  },
  {
    "name": "กาญจนบุรี",
    "nameEn": "Kanchanaburi Province"
  },
  {
    "name": "การขับร้อง",
    "nameEn": "Vocal Performance & Classical Singing"
  },
  {
    "name": "การขับลำนำ",
    "nameEn": "Poetic Recitation & Lyric Chant"
  },
  {
    "name": "การขึ้นลอย",
    "nameEn": "Khuen Loi (Master Khon Acrobatic Balancing Stance)"
  },
  {
    "name": "การจับปลา",
    "nameEn": "Fish Catching / Traditional Fishing"
  },
  {
    "name": "การดีด",
    "nameEn": "Plucking Technique (String Instruments)"
  },
  {
    "name": "การตีกลอง",
    "nameEn": "Drumming Artistry & Technique"
  },
  {
    "name": "การต่อสู้",
    "nameEn": "Combat / Martial Engagement"
  },
  {
    "name": "การทอ",
    "nameEn": "Textile Weaving Art"
  },
  {
    "name": "การทำขวัญ",
    "nameEn": "Tham Khwan (Soul-Calling & Auspicious Blessing Rite)"
  },
  {
    "name": "การนุ่งห่ม",
    "nameEn": "Traditional Draping & Garment Wearing"
  },
  {
    "name": "การปั้น",
    "nameEn": "Ceramic Sculpting & Modeling"
  },
  {
    "name": "การรบ",
    "nameEn": "Battle / Warfare"
  },
  {
    "name": "การร่อนแร่",
    "nameEn": "Mineral Panning / Tin Sifting"
  },
  {
    "name": "การละเล่นพื้นเมือง",
    "nameEn": "Traditional Folk Games & Pastimes"
  },
  {
    "name": "การศึก",
    "nameEn": "War / Military Campaign"
  },
  {
    "name": "การสอน",
    "nameEn": "Didactic Instruction / Moral Teaching"
  },
  {
    "name": "การุณราช",
    "nameEn": "Karunrat (Golden Steed Demon)"
  },
  {
    "name": "การเกี้ยวพาราสี",
    "nameEn": "Courtship & Romantic Play"
  },
  {
    "name": "การเก็บใบชา",
    "nameEn": "Tea Leaves Harvesting"
  },
  {
    "name": "การโปรย",
    "nameEn": "Scattering Auspicious Petals & Blessings"
  },
  {
    "name": "การไถ",
    "nameEn": "Plowing the Paddy Field"
  },
  {
    "name": "กาลสูร",
    "nameEn": "Kalasur (Time / Death Demon)"
  },
  {
    "name": "กาฬสินธุ์",
    "nameEn": "Kalasin Province"
  },
  {
    "name": "กิจจะ",
    "nameEn": "Solemn Ritual Duty / Affair"
  },
  {
    "name": "กิจวัตร",
    "nameEn": "Daily Routine / Folkway"
  },
  {
    "name": "กินรี",
    "nameEn": "Kinnari (Half-Woman Half-Bird Celestial Being)"
  },
  {
    "name": "กินเนสส์บุ๊ค",
    "nameEn": "Guinness World Records"
  },
  {
    "name": "กุณฑล",
    "nameEn": "Kunthon (Royal Earring / Ear Ornament)"
  },
  {
    "name": "กุมภกรรณ",
    "nameEn": "Kumbhakarna (Noble Giant Demon / Brother of Ravana)"
  },
  {
    "name": "กุลสตรี",
    "nameEn": "Refined Noble Lady / Virtuous Maiden"
  },
  {
    "name": "ขนเพชร",
    "nameEn": "Diamond Body Hair (Hanuman's Invulnerability)"
  },
  {
    "name": "ขบวนแห่",
    "nameEn": "Ceremonial Procession / Pageant"
  },
  {
    "name": "ขอขมา",
    "nameEn": "Asking Pardon & Seeking Forgiveness"
  },
  {
    "name": "ของที่ระลึก",
    "nameEn": "Souvenir & Cultural Keepsake"
  },
  {
    "name": "ของป่า",
    "nameEn": "Forest Foraged Produce"
  },
  {
    "name": "ขัดตาทัพ",
    "nameEn": "Intercepting the Advance / Rearguard Clash"
  },
  {
    "name": "ขันดอก",
    "nameEn": "Pedestal Tray of Sacred Flowers (Khan Dok)"
  },
  {
    "name": "ขับร้อง",
    "nameEn": "Singing / Vocalization"
  },
  {
    "name": "ขับลำ",
    "nameEn": "Chanting Folk Ballads"
  },
  {
    "name": "ขับไล่",
    "nameEn": "Expelling / Exorcism"
  },
  {
    "name": "ขับไล่เสนียดจัญไร",
    "nameEn": "Banishment of Inauspiciousness & Evil Spirits"
  },
  {
    "name": "ขีดขิน",
    "nameEn": "Kishkindha (Mythical Monkey Kingdom)"
  },
  {
    "name": "ขี่ม้า",
    "nameEn": "Horseback Riding / Equestrian Skill"
  },
  {
    "name": "ขึ้นทะเบียน",
    "nameEn": "Heritage Registration / Inscription"
  },
  {
    "name": "ขุนช้าง",
    "nameEn": "Khun Chang (Wealthy Suitor in Khun Chang Khun Phaen)"
  },
  {
    "name": "ขุนนาง",
    "nameEn": "Nobility / Royal Courtiers"
  },
  {
    "name": "ขุนนางและข้าราชการ",
    "nameEn": "Courtiers & Civil Officials"
  },
  {
    "name": "ขุนแผน",
    "nameEn": "Khun Phaen (Warrior Hero & Sorcerer)"
  },
  {
    "name": "ข่ายเพชร",
    "nameEn": "Diamond Net Pattern (Khai Phet)"
  },
  {
    "name": "ข่ายเหล็ก",
    "nameEn": "Iron Chainmail Net"
  },
  {
    "name": "ข้าวเหนียว",
    "nameEn": "Glutinous Sticky Rice (Khao Niao)"
  },
  {
    "name": "ข้าศึก",
    "nameEn": "Enemy / Opposing Host"
  },
  {
    "name": "ข้าหลวง",
    "nameEn": "Governor / Royal Retainer"
  },
  {
    "name": "ความคล่องแคล่ว",
    "nameEn": "Agility & Physical Dexterity"
  },
  {
    "name": "ความพอเพียง",
    "nameEn": "Sufficiency / Modest Contentment"
  },
  {
    "name": "คำร้อง",
    "nameEn": "Song Lyrics / Poetic Text"
  },
  {
    "name": "คู่ต่อสู้",
    "nameEn": "Combatant / Opponent"
  },
  {
    "name": "คู่ใจ",
    "nameEn": "Cherished Companion / Loyal Steed"
  },
  {
    "name": "ค้าขาย",
    "nameEn": "Commerce & Local Trading"
  },
  {
    "name": "งานประติมากรรม",
    "nameEn": "Sculptural Artwork"
  },
  {
    "name": "งานรื่นเริง",
    "nameEn": "Festive Celebration / Social Merrymaking"
  },
  {
    "name": "งานแต่งงาน",
    "nameEn": "Wedding Celebration Ceremony"
  },
  {
    "name": "จนตาย",
    "nameEn": "Unto Death / Faithful to the End"
  },
  {
    "name": "จองถนน",
    "nameEn": "Bridging the Ocean Causeway to Lanka"
  },
  {
    "name": "จังหวะชั้นเดียว",
    "nameEn": "Single-Meter Rhythm (Fast Tempo)"
  },
  {
    "name": "จัดทัพ",
    "nameEn": "Arranging Battle Formations"
  },
  {
    "name": "จับนาง",
    "nameEn": "Chap Nang (Hero Courtship / Princess-Capturing Choreography)"
  },
  {
    "name": "จับระบำ",
    "nameEn": "Group Dance Arrangement"
  },
  {
    "name": "จารึก",
    "nameEn": "Epigraphic Inscription"
  },
  {
    "name": "จำกาย",
    "nameEn": "Disguising One's Form"
  },
  {
    "name": "จำแลง",
    "nameEn": "Shape-Shifting / Transformation"
  },
  {
    "name": "จิตรกรรม",
    "nameEn": "Painting & Pictorial Art"
  },
  {
    "name": "จีนรัว",
    "nameEn": "Chin Rua (Chinese-Influenced Fast Drum Roll)"
  },
  {
    "name": "จีนรำพัด",
    "nameEn": "Chinese Fan Dance (Chin Ram Phat)"
  },
  {
    "name": "จุดไฟ",
    "nameEn": "Kindling Sacred Flame"
  },
  {
    "name": "ฉลองพระองค์",
    "nameEn": "Royal Robes / Monarchical Regalia"
  },
  {
    "name": "ฉุยฉาย",
    "nameEn": "Chui Chai (Transformation & Vanity Dance Genre)"
  },
  {
    "name": "ชั้นเชิง",
    "nameEn": "Tactical Mastery / Artistic Finesse"
  },
  {
    "name": "ชั้นเดียว",
    "nameEn": "Single-Tier Architectural Roof"
  },
  {
    "name": "ชาติพันธุ์",
    "nameEn": "Ethnicity / Cultural Heritage Group"
  },
  {
    "name": "ชามพูวราช",
    "nameEn": "Champuwarat (Venerable Bear / Monkey Elder)"
  },
  {
    "name": "ชายหนุ่ม",
    "nameEn": "Young Man / Suitor"
  },
  {
    "name": "ชาวนา",
    "nameEn": "Rice Farmer (Chao Na)"
  },
  {
    "name": "ชาวพื้นเมือง",
    "nameEn": "Indigenous Folk / Native Inhabitants"
  },
  {
    "name": "ชาวภูไท",
    "nameEn": "Phu Thai Ethnic Group"
  },
  {
    "name": "ชาวเขา",
    "nameEn": "Highland Ethnic Groups / Hill Tribe Folk"
  },
  {
    "name": "ชาวเหนือ",
    "nameEn": "Northern Thai People (Chao Nuea)"
  },
  {
    "name": "ชุมนุม",
    "nameEn": "Assembly / Gathering Song Mode"
  },
  {
    "name": "ชุมพร",
    "nameEn": "Chumphon Province"
  },
  {
    "name": "ช่อดอกไม้",
    "nameEn": "Floral Bouquet / Posy"
  },
  {
    "name": "ช้างเอราวัณ",
    "nameEn": "Airavata Elephant (Erawan / Three-Headed Mount of Indra)"
  },
  {
    "name": "ดนตรีพื้นบ้าน",
    "nameEn": "Folk Music / Indigenous Instruments"
  },
  {
    "name": "ดนตรีไทย",
    "nameEn": "Traditional Thai Music"
  },
  {
    "name": "ดวงแก้ว",
    "nameEn": "Wish-Fulfilling Luminous Jewel (Mani)"
  },
  {
    "name": "ดอกไม้",
    "nameEn": "Blossoming Flowers"
  },
  {
    "name": "ดอกไม้เงิน",
    "nameEn": "Silver Flower Offering"
  },
  {
    "name": "ดาวดึงส์",
    "nameEn": "Tavatimsa Heaven (Dao-wa-dueng / Second Deva Realm)"
  },
  {
    "name": "ดินดาล",
    "nameEn": "Subsoil Clay / Bedrock"
  },
  {
    "name": "ตะกร้อ",
    "nameEn": "Takraw Rattan Ball"
  },
  {
    "name": "ตะเขิ่ง",
    "nameEn": "Takhoeng (Mon-Style Drum Rhythm)"
  },
  {
    "name": "ตัวต่อตัว",
    "nameEn": "One-on-One Combat Duel"
  },
  {
    "name": "ตัวพระ",
    "nameEn": "Phra (Male Protagonist / Hero Role)"
  },
  {
    "name": "ตัวละครชั้นสูง",
    "nameEn": "High-Born Noble Dramatic Characters"
  },
  {
    "name": "ตัวละครรอง",
    "nameEn": "Secondary Supporting Characters"
  },
  {
    "name": "ตามเพลง",
    "nameEn": "Dancing in Harmony with Musical Tempo"
  },
  {
    "name": "ตารี",
    "nameEn": "Tari (Malay Dance / Dancer)"
  },
  {
    "name": "ตารีกีปัส",
    "nameEn": "Tari Kipas (Malay Fan Dance)"
  },
  {
    "name": "ตารีบุหงา",
    "nameEn": "Tari Bu-nga (Malay Bouquet Prop)"
  },
  {
    "name": "ตำนาน",
    "nameEn": "Myth / Sacred Legend"
  },
  {
    "name": "ติดมือ",
    "nameEn": "Held in Hand as Prop"
  },
  {
    "name": "ตีลังกา",
    "nameEn": "Somersault / Acrobatic Flip"
  },
  {
    "name": "ต่อสู้",
    "nameEn": "Martial Combat / Battle Choreography"
  },
  {
    "name": "ต้นขา",
    "nameEn": "Thigh (Martial Striking Anatomy)"
  },
  {
    "name": "ต้นรัง",
    "nameEn": "Shorea Siamensis (Sacred Rang Tree)"
  },
  {
    "name": "ต้นลีลาวดี",
    "nameEn": "Frangipani Tree (Plumeria / Lilawadi)"
  },
  {
    "name": "ต้นไม้ในวรรณคดี",
    "nameEn": "Flora in Classical Thai Literature"
  },
  {
    "name": "ถอยทัพ",
    "nameEn": "Retreating the Forces"
  },
  {
    "name": "ทศกัณฐ์",
    "nameEn": "Thotsakan (Ravana / Ten-Headed Demon King)"
  },
  {
    "name": "ทหารเอก",
    "nameEn": "Chief General / Champion Warrior"
  },
  {
    "name": "ทอผ้า",
    "nameEn": "Silk Weaving Craft"
  },
  {
    "name": "ทะเล",
    "nameEn": "Sea / Coastal Waters"
  },
  {
    "name": "ทักษะเฉพาะตัว",
    "nameEn": "Individual Artistry & Specialized Technique"
  },
  {
    "name": "ทับทิม",
    "nameEn": "Ruby (Red Corundum Gem)"
  },
  {
    "name": "ทับหลัง",
    "nameEn": "Lintel (Stone Carved Lintel)"
  },
  {
    "name": "ทัพหน้า",
    "nameEn": "Vanguard / Forward Battle Division"
  },
  {
    "name": "ทางธรรมชาติ",
    "nameEn": "Naturalistic Landscape & Ecology"
  },
  {
    "name": "ทำนอง",
    "nameEn": "Melody & Musical Contour"
  },
  {
    "name": "ทำนองเพลง",
    "nameEn": "Musical Tune & Melodic Structure"
  },
  {
    "name": "ทำนาย",
    "nameEn": "Prophesying / Divination"
  },
  {
    "name": "ทำพิธี",
    "nameEn": "Performing Sacred Rites"
  },
  {
    "name": "ทิพยวิมาน",
    "nameEn": "Celestial Divine Palace (Vimana)"
  },
  {
    "name": "ท่วงทำนอง",
    "nameEn": "Melodic Cadence & Rhythm"
  },
  {
    "name": "ท้าวพิชัยพิษณุกร",
    "nameEn": "King Phichai Phitsanukon"
  },
  {
    "name": "ท้าวลัสเตียน",
    "nameEn": "King Lastian (Father of Ravana)"
  },
  {
    "name": "ท้าวสัทธาสูร",
    "nameEn": "King Satthasur (Demon Chieftain of Romakhap)"
  },
  {
    "name": "ธงไทย",
    "nameEn": "Thai National Flag"
  },
  {
    "name": "ธัญญาหาร",
    "nameEn": "Cereal Grains & Harvest Abundance"
  },
  {
    "name": "ธิเบศร์",
    "nameEn": "Thibet (Sovereign Ruler)"
  },
  {
    "name": "นครปฐม",
    "nameEn": "Nakhon Pathom Province"
  },
  {
    "name": "นครพนม",
    "nameEn": "Nakhon Phanom Province"
  },
  {
    "name": "นครราชสีมา",
    "nameEn": "Nakhon Ratchasima Province"
  },
  {
    "name": "นครศรีธรรมราช",
    "nameEn": "Nakhon Si Thammarat Province"
  },
  {
    "name": "นนทก",
    "nameEn": "Nontok (Diamond-Fingered Asura Predecessor of Ravana)"
  },
  {
    "name": "นักษัตร",
    "nameEn": "Twelve Zodiac Signs (Naksat)"
  },
  {
    "name": "นางกินรี",
    "nameEn": "Nang Kinnari (Celestial Bird Maiden)"
  },
  {
    "name": "นางพญาคำปิน",
    "nameEn": "Queen Nang Phaya Kham Pin"
  },
  {
    "name": "นางฟ้า",
    "nameEn": "Apsara (Celestial Nymph / Angel)"
  },
  {
    "name": "นางรื่น",
    "nameEn": "Nang Ruen (Court Attendant)"
  },
  {
    "name": "นางสวาหะ",
    "nameEn": "Nang Sawaha (Mother of Hanuman)"
  },
  {
    "name": "นางสีดา",
    "nameEn": "Nang Sida (Sita / Consort of Rama)"
  },
  {
    "name": "นางอัปสราบายน",
    "nameEn": "Bayon Apsara (Khmer Celestial Dancer)"
  },
  {
    "name": "นางเอก",
    "nameEn": "Nang Ek (Female Protagonist / Heroine Role)"
  },
  {
    "name": "นางโรย",
    "nameEn": "Nang Roi (Court Maiden)"
  },
  {
    "name": "นางใน",
    "nameEn": "Nang Nai (Inner Court Royal Maiden)"
  },
  {
    "name": "นาฏศิลป์อินเดีย",
    "nameEn": "Indian Classical Dance"
  },
  {
    "name": "นานาชาติ",
    "nameEn": "International / Global"
  },
  {
    "name": "นายขวัญ",
    "nameEn": "Nai Khwan (Loyal Page / Retainer)"
  },
  {
    "name": "นายแก้ว",
    "nameEn": "Nai Kaeo (Loyal Page / Retainer)"
  },
  {
    "name": "นิลพาหุ",
    "nameEn": "Ninlapahu (Blue-Armed Demon General)"
  },
  {
    "name": "นิ้วเพชร",
    "nameEn": "Diamond Finger (Nontok's Deadly Boon)"
  },
  {
    "name": "น้องสาว",
    "nameEn": "Younger Sister"
  },
  {
    "name": "น้อยใจยา",
    "nameEn": "Noi Chaiya (Northern Folk Romantic Hero)"
  },
  {
    "name": "น้ำมันยาง",
    "nameEn": "Yang Tree Resin Oil"
  },
  {
    "name": "บทร้อง",
    "nameEn": "Song Lyrics / Vocal Script"
  },
  {
    "name": "บทละคร",
    "nameEn": "Dramatic Script / Play Text"
  },
  {
    "name": "บรรพต",
    "nameEn": "Mountain / Sacred Peak"
  },
  {
    "name": "บรรพบุรุษ",
    "nameEn": "Ancestors / Forefathers"
  },
  {
    "name": "บริวาร",
    "nameEn": "Retinue / Attendants"
  },
  {
    "name": "บอกทาง",
    "nameEn": "Wayfinding / Navigating Landmarks"
  },
  {
    "name": "บินหนี",
    "nameEn": "Flight Escape (Acrobatic Flight Dance)"
  },
  {
    "name": "บุตรชาย",
    "nameEn": "Son"
  },
  {
    "name": "บุปเพสันนิวาส",
    "nameEn": "Predestined Soulmates / Past Life Karmic Bond"
  },
  {
    "name": "บุรี",
    "nameEn": "Buri (Fortified Town / City)"
  },
  {
    "name": "บุรีรัมย์",
    "nameEn": "Buriram Province"
  },
  {
    "name": "บุษราคัม",
    "nameEn": "Yellow Sapphire (Pushparagam)"
  },
  {
    "name": "บุหงา",
    "nameEn": "Bu-nga (Potpourri Scented Blossom Sachet)"
  },
  {
    "name": "บุหรงซีงอ",
    "nameEn": "Burong Si-ngo (Traditional Southern Bird Procession)"
  },
  {
    "name": "บูชาครู",
    "nameEn": "Worshipping the Arts Teachers & Masters"
  },
  {
    "name": "บูชายัญ",
    "nameEn": "Sacrificial Offering / Yajna Rite"
  },
  {
    "name": "ปรศุราม",
    "nameEn": "Parashurama (Axe-Bearing Avatar of Vishnu)"
  },
  {
    "name": "ประชิดตัว",
    "nameEn": "Close-Quarters Combat Posture"
  },
  {
    "name": "ประติมากรรม",
    "nameEn": "Sculpture"
  },
  {
    "name": "ประติมากรรมทางศาสนา",
    "nameEn": "Religious Iconography & Sacred Statuary"
  },
  {
    "name": "ประทาน",
    "nameEn": "Graciously Bestowing a Boon"
  },
  {
    "name": "ปราชัย",
    "nameEn": "Defeat / Overthrow"
  },
  {
    "name": "ปราสาทพนมรุ้ง",
    "nameEn": "Phanom Rung Historical Stone Sanctuary"
  },
  {
    "name": "ปราสาทพระขรรค์",
    "nameEn": "Preah Khan Stone Sanctuary"
  },
  {
    "name": "ปราสาทหินพิมาย",
    "nameEn": "Phimai Historical Stone Sanctuary"
  },
  {
    "name": "ปราสาทเมืองสิงห์",
    "nameEn": "Muang Sing Historical Stone Park"
  },
  {
    "name": "ปัดเป่า",
    "nameEn": "Dispersing Calamity / Warding Off Misfortune"
  },
  {
    "name": "ปัตตานี",
    "nameEn": "Pattani Province"
  },
  {
    "name": "ปางลีลา",
    "nameEn": "Leela Attitude (The Walking Buddha Graceful Posture)"
  },
  {
    "name": "ปารวตี",
    "nameEn": "Goddess Parvati (Consort of Shiva)"
  },
  {
    "name": "ปิดหน้า",
    "nameEn": "Veiling / Masking the Face"
  },
  {
    "name": "ปูนปั้น",
    "nameEn": "Stucco Relief Art (Pun Pan)"
  },
  {
    "name": "ป้องกันตัว",
    "nameEn": "Self-Defense Technique"
  },
  {
    "name": "ผางประทีป",
    "nameEn": "Phang Prathip (Earthen Oil Lamp Offering)"
  },
  {
    "name": "ผีภู",
    "nameEn": "Mountain Spirit / Tutelary Deity"
  },
  {
    "name": "ผึ่งแดด",
    "nameEn": "Sun-Drying in the Open Air"
  },
  {
    "name": "ผู้ครองนคร",
    "nameEn": "Sovereign Ruler of the Realm"
  },
  {
    "name": "ผู้มีพระคุณ",
    "nameEn": "Benefactors / Revered Teachers"
  },
  {
    "name": "ผู้แสดงฝ่ายชาย",
    "nameEn": "Male Performers (Phra / Yak / Ling)"
  },
  {
    "name": "ผู้แสดงฝ่ายหญิง",
    "nameEn": "Female Performers (Nang)"
  },
  {
    "name": "ผ้าไหม",
    "nameEn": "Thai Silk Textile"
  },
  {
    "name": "ฝั่งน้ำ",
    "nameEn": "Riverbank / Shoreline"
  },
  {
    "name": "ฝากตัว",
    "nameEn": "Submitting as Disciple / Servant"
  },
  {
    "name": "ฝ่ามือ",
    "nameEn": "Open Palm Strike & Mudra Hand Form"
  },
  {
    "name": "พญาขร",
    "nameEn": "Phraya Khon (Demon King Khara of Romakhap)"
  },
  {
    "name": "พญาทูษณ์",
    "nameEn": "Phraya Thut (Demon King of Charoek)"
  },
  {
    "name": "พญาผานอง",
    "nameEn": "Phraya Pha Nong (Lord of Nan)"
  },
  {
    "name": "พรหมาสตร์",
    "nameEn": "Brahmastra Weapon of Brahma"
  },
  {
    "name": "พระคเณศ",
    "nameEn": "Lord Ganesha (God of Wisdom and Arts)"
  },
  {
    "name": "พระจันทร์",
    "nameEn": "Chandra (The Moon Deity)"
  },
  {
    "name": "พระชายา",
    "nameEn": "Royal Princess Consort"
  },
  {
    "name": "พระญาติ",
    "nameEn": "Royal Kin / Relatives"
  },
  {
    "name": "พระตำหนัก",
    "nameEn": "Royal Pavilion / Palace Residence"
  },
  {
    "name": "พระนารายณ์",
    "nameEn": "Lord Narayana (Vishnu / Preserver God)"
  },
  {
    "name": "พระนิพนธ์",
    "nameEn": "Royal Literary Composition"
  },
  {
    "name": "พระบรมราชชนนีพันปีหลวง",
    "nameEn": "Queen Sirikit The Queen Mother"
  },
  {
    "name": "พระบาทสมเด็จพระจอมเกล้าเจ้าอยู่หัว",
    "nameEn": "King Mongkut (Rama IV)"
  },
  {
    "name": "พระบาทสมเด็จพระจุลจอมเกล้าเจ้าอยู่หัว",
    "nameEn": "King Chulalongkorn (Rama V)"
  },
  {
    "name": "พระพรหม",
    "nameEn": "Lord Brahma (Creator God)"
  },
  {
    "name": "พระพาย",
    "nameEn": "Phra Phai (Vayu / God of Wind and Father of Hanuman)"
  },
  {
    "name": "พระพี่เลี้ยง",
    "nameEn": "Royal Governess / Mentor Attendant"
  },
  {
    "name": "พระพุทธรูป",
    "nameEn": "Buddha Statue / Sacred Image"
  },
  {
    "name": "พระมหากษัตริย์",
    "nameEn": "The Monarchy / Sovereign King"
  },
  {
    "name": "พระยา",
    "nameEn": "Phraya (High Noble Title)"
  },
  {
    "name": "พระราชธิดา",
    "nameEn": "Royal Princess Daughter"
  },
  {
    "name": "พระราชบัญชา",
    "nameEn": "Royal Command / Sovereign Mandate"
  },
  {
    "name": "พระราชพิธี",
    "nameEn": "Royal Ceremony / State Rite"
  },
  {
    "name": "พระราชพิธีหลวง",
    "nameEn": "Grand Royal Court Rite"
  },
  {
    "name": "พระราชวังบวรสถานมงคล",
    "nameEn": "Front Palace (Bowon Sathan Mongkhon)"
  },
  {
    "name": "พระราม",
    "nameEn": "Phra Ram (Prince Rama / Avatar of Vishnu)"
  },
  {
    "name": "พระลอ",
    "nameEn": "Phra Lo (Hero Prince of Phra Lo)"
  },
  {
    "name": "พระลักษมณ์",
    "nameEn": "Phra Lak (Prince Lakshmana)"
  },
  {
    "name": "พระลาน",
    "nameEn": "Royal Palace Esplanade / Courtyard"
  },
  {
    "name": "พระศิวะ",
    "nameEn": "Lord Shiva (Ishvara / Supreme Auspicious God)"
  },
  {
    "name": "พระสวามี",
    "nameEn": "Royal Husband / Consort Prince"
  },
  {
    "name": "พระสังข์",
    "nameEn": "Phra Sang (Prince of the Conch Shell)"
  },
  {
    "name": "พระองค์",
    "nameEn": "Royal Personage / His Royal Highness"
  },
  {
    "name": "พระอินทร์",
    "nameEn": "Lord Indra (King of the Gods and Tavatimsa Heaven)"
  },
  {
    "name": "พระอิศวร",
    "nameEn": "Lord Ishvara (Shiva Supreme)"
  },
  {
    "name": "พระอุมา",
    "nameEn": "Goddess Uma (Devi Uma / Parvati)"
  },
  {
    "name": "พระอุโบสถ",
    "nameEn": "Ubosot (Main Ordination Hall)"
  },
  {
    "name": "พระเจ้าชัยวรมัน",
    "nameEn": "King Jayavarman (Ancient Sovereign)"
  },
  {
    "name": "พระเจ้าบรมวงศ์เธอกรมพระนราธิปประพันธ์พงศ์",
    "nameEn": "Prince Narathip Praphanphong (Master Dramatist)"
  },
  {
    "name": "พระเพื่อน",
    "nameEn": "Phra Phuean (Northern Princess Phuean)"
  },
  {
    "name": "พระเมรุ",
    "nameEn": "Royal Funeral Pyre (Phra Meru)"
  },
  {
    "name": "พระเอก",
    "nameEn": "Phra Ek (Male Lead / Hero Role)"
  },
  {
    "name": "พระแพง",
    "nameEn": "Phra Phaeng (Northern Princess Phaeng)"
  },
  {
    "name": "พระแม่คงคา",
    "nameEn": "Phra Mae Khongkha (Goddess Ganga of Waters)"
  },
  {
    "name": "พระไวย",
    "nameEn": "Phra Wai (Warrior Son of Khun Phaen)"
  },
  {
    "name": "พราหมณ์",
    "nameEn": "Brahmin Priest / Ritualist"
  },
  {
    "name": "พลลิง",
    "nameEn": "Monkey Soldier Troop"
  },
  {
    "name": "พลวานร",
    "nameEn": "Vanara Monkey Host"
  },
  {
    "name": "พลับพลา",
    "nameEn": "Royal Reception Pavilion (Phlapphla)"
  },
  {
    "name": "พลายชุมพล",
    "nameEn": "Phlai Chumphon (Son of Khun Phaen)"
  },
  {
    "name": "พวงมาลัย",
    "nameEn": "Fragrant Floral Garland (Phuang Malai)"
  },
  {
    "name": "พัดเรนัง",
    "nameEn": "Renang Fan (Traditional Malay Prop)"
  },
  {
    "name": "พาลี",
    "nameEn": "Vali (Phali / King of Kishkindha)"
  },
  {
    "name": "พิธีทางศาสนา",
    "nameEn": "Religious Ceremony"
  },
  {
    "name": "พิธีไหว้ครู",
    "nameEn": "Wai Khru Homage Ceremony"
  },
  {
    "name": "พิเภก",
    "nameEn": "Phiphek (Bibhek / Righteous Demon Astrologer)"
  },
  {
    "name": "พี่เลี้ยง",
    "nameEn": "Court Attendant / Nanny Mentor"
  },
  {
    "name": "พืชพรรณ",
    "nameEn": "Botanical Flora & Vegetation"
  },
  {
    "name": "พื้นบ้านภาคใต้",
    "nameEn": "Southern Thai Folk Performing Arts"
  },
  {
    "name": "พุทธศตวรรษ",
    "nameEn": "Buddhist Era Century"
  },
  {
    "name": "ฟองน้ำ",
    "nameEn": "Sea Sponge / Froth"
  },
  {
    "name": "ฟันปลา",
    "nameEn": "Sawtooth Zigzag Geometric Motif"
  },
  {
    "name": "ฟาดฟัน",
    "nameEn": "Slashing & Parrying (Sword Martial Art)"
  },
  {
    "name": "ภาคกลาง",
    "nameEn": "Central Thailand Region"
  },
  {
    "name": "ภาคตะวันออกเฉียงเหนือ",
    "nameEn": "Northeastern Thailand Region (Isan)"
  },
  {
    "name": "ภาคอีสาน",
    "nameEn": "Isan Region"
  },
  {
    "name": "ภาคเหนือ",
    "nameEn": "Northern Thailand Region (Lanna)"
  },
  {
    "name": "ภาคใต้",
    "nameEn": "Southern Thailand Region"
  },
  {
    "name": "ภาชนะดินเผา",
    "nameEn": "Earthenware & Terracotta Vessels"
  },
  {
    "name": "ภาพจำหลัก",
    "nameEn": "Bas-Relief Stone Carving"
  },
  {
    "name": "ภาพจิตรกรรมฝาผนัง",
    "nameEn": "Traditional Mural Painting"
  },
  {
    "name": "ภารตนาฏยัม",
    "nameEn": "Bharatanatyam Classical Dance"
  },
  {
    "name": "ภาษามลายู",
    "nameEn": "Malay Language"
  },
  {
    "name": "ภูเขา",
    "nameEn": "Mountain / Highlands"
  },
  {
    "name": "มณีพิชัย",
    "nameEn": "Mani Phichai (Prince Mani Phichai)"
  },
  {
    "name": "มรกต",
    "nameEn": "Emerald (Green Beryl Gem)"
  },
  {
    "name": "มลายู",
    "nameEn": "Malay People & Culture"
  },
  {
    "name": "มวยโบราณ",
    "nameEn": "Muay Boran (Traditional Ancient Boxing)"
  },
  {
    "name": "มวยไทย",
    "nameEn": "Muay Thai (Thai Kickboxing Art)"
  },
  {
    "name": "มหาสมุทร",
    "nameEn": "Ocean / The Great Deep"
  },
  {
    "name": "มังกร",
    "nameEn": "Dragon (Mythological Serpentine Beast)"
  },
  {
    "name": "มังกรกัณฐ์",
    "nameEn": "Mangkonkan (Demon General / Son of Ronaphak)"
  },
  {
    "name": "มัยราพณ์",
    "nameEn": "Maiyarap (Sorcerer Demon King of the Underworld)"
  },
  {
    "name": "มารดา",
    "nameEn": "Mother"
  },
  {
    "name": "มารีศ",
    "nameEn": "Marit (Maricha / Golden Deer Demon)"
  },
  {
    "name": "มิตรไมตรี",
    "nameEn": "Cordially Welcoming Friendship / Goodwill"
  },
  {
    "name": "มีฤทธิ์",
    "nameEn": "Endowed with Supernatural Prowess"
  },
  {
    "name": "มีแบบแผน",
    "nameEn": "Structured Form / Classical Precepts"
  },
  {
    "name": "มือขวา",
    "nameEn": "Right Hand / Right-Hand Offering"
  },
  {
    "name": "มือซ้าย",
    "nameEn": "Left Hand / Left-Hand Offering"
  },
  {
    "name": "มือเปล่า",
    "nameEn": "Bare-Handed Combat & Movement"
  },
  {
    "name": "มุกดาหาร",
    "nameEn": "Mukdahan Province"
  },
  {
    "name": "มุสลิม",
    "nameEn": "Muslim Faith / Culture"
  },
  {
    "name": "มเหสี",
    "nameEn": "Queen Consort"
  },
  {
    "name": "มโนราห์",
    "nameEn": "Manora (Southern Nora Dance-Drama)"
  },
  {
    "name": "มโนห์รา",
    "nameEn": "Manohra (Manora Kinnari Princess)"
  },
  {
    "name": "ยมะ",
    "nameEn": "Lord Yama (God of Death and Justice)"
  },
  {
    "name": "ยอพระกลิ่น",
    "nameEn": "Yor Phra Klin (Celebrated Princess in Lakhon Nok)"
  },
  {
    "name": "ยักษิณี",
    "nameEn": "Yakshini (Demoness / Female Ogre)"
  },
  {
    "name": "ยุทธหัตถี",
    "nameEn": "Yuttha Hatthi (Royal Elephant Duel)"
  },
  {
    "name": "ยูเนสโก",
    "nameEn": "UNESCO World Cultural Heritage"
  },
  {
    "name": "ย่องหงิด",
    "nameEn": "Yong-ngit (Refined Classical Dance Posture)"
  },
  {
    "name": "ย่านาง",
    "nameEn": "Mae Yanang (Guardian Goddess of Boats and Vehicles)"
  },
  {
    "name": "รจนา",
    "nameEn": "Rotjana (Princess Rotjana of Sang Thong)"
  },
  {
    "name": "รอยยิ้ม",
    "nameEn": "The Smile of Warm Hospitality"
  },
  {
    "name": "ระดับชาติ",
    "nameEn": "National Level"
  },
  {
    "name": "ระบำนานาชาติ",
    "nameEn": "International Comparative Dance"
  },
  {
    "name": "ระบำมาตรฐาน",
    "nameEn": "Standard Classical Dance Suite"
  },
  {
    "name": "ระบำโบราณคดี",
    "nameEn": "Archaeological Dance Series"
  },
  {
    "name": "รังควาญ",
    "nameEn": "Tormenting / Malevolent Haunting"
  },
  {
    "name": "รัชกาล",
    "nameEn": "Reign / Monarchy Era"
  },
  {
    "name": "รัชฎา",
    "nameEn": "Silver Metal / Queen Ratchada"
  },
  {
    "name": "รับสั่ง",
    "nameEn": "Receiving Royal Command"
  },
  {
    "name": "รับอาสา",
    "nameEn": "Volunteering for a Heroic Mission"
  },
  {
    "name": "รับใช้",
    "nameEn": "Serving with Devotion"
  },
  {
    "name": "รัวฉิ่ง",
    "nameEn": "Rua Ching (Rapid Small Cymbal Roll)"
  },
  {
    "name": "ราชสำนัก",
    "nameEn": "Royal Court"
  },
  {
    "name": "รามสูร",
    "nameEn": "Ramasun (Thunder Demon / Wielder of the Battle-Axe)"
  },
  {
    "name": "รามเกียรติ์",
    "nameEn": "The Ramakien (Thai Ramayana Epic)"
  },
  {
    "name": "รำคู่",
    "nameEn": "Duet Dance (Ram Khu)"
  },
  {
    "name": "รำพัด",
    "nameEn": "Fan Dance (Ram Phat)"
  },
  {
    "name": "รำมาตรฐาน",
    "nameEn": "Standardized Thai Classical Dance"
  },
  {
    "name": "รำเดี่ยว",
    "nameEn": "Solo Dance (Ram Diao)"
  },
  {
    "name": "ริมแม่น้ำ",
    "nameEn": "Riverside Landscape"
  },
  {
    "name": "รุทการ",
    "nameEn": "Ruthakan (Heroic Demon Battle Movement)"
  },
  {
    "name": "รูปทอง",
    "nameEn": "Gilded Figure / Golden Form"
  },
  {
    "name": "รูปนอก",
    "nameEn": "Rup Nok (Exoteric Theatrical Form)"
  },
  {
    "name": "ร่มพระบารมี",
    "nameEn": "Shelter of Royal Merit & Sovereign Grace"
  },
  {
    "name": "ฤดูฝน",
    "nameEn": "Monsoon / Rainy Season"
  },
  {
    "name": "ฤาษี",
    "nameEn": "Rishi (Ascetic Hermit / Sage)"
  },
  {
    "name": "ลอยกระทง",
    "nameEn": "Loy Krathong Lantern Floating"
  },
  {
    "name": "ลอยน้ำ",
    "nameEn": "Floating on Water"
  },
  {
    "name": "ละครชาตรี",
    "nameEn": "Lakhon Chatri (Ancestral Dance-Drama)"
  },
  {
    "name": "ละครดึกดำบรรพ์",
    "nameEn": "Lakhon Duekdamban (Operatic Court Drama)"
  },
  {
    "name": "ละครนอก",
    "nameEn": "Lakhon Nok (Popular Folk Dance-Drama)"
  },
  {
    "name": "ละครพันทาง",
    "nameEn": "Lakhon Phanthang (Hybrid Period Drama)"
  },
  {
    "name": "ละครรำพื้นบ้าน",
    "nameEn": "Folk Dance-Drama"
  },
  {
    "name": "ละครเสภา",
    "nameEn": "Lakhon Sepha (Poetic Recitation Drama)"
  },
  {
    "name": "ละครใน",
    "nameEn": "Lakhon Nai (Inner Palace Classical Dance-Drama)"
  },
  {
    "name": "ลายเส้น",
    "nameEn": "Linear Ornamental Motif"
  },
  {
    "name": "ลาวครั่ง",
    "nameEn": "Lao Khrang Ethnic Community"
  },
  {
    "name": "ลาวเวียง",
    "nameEn": "Lao Wiang Ethnic Community"
  },
  {
    "name": "ลำตังหวาย",
    "nameEn": "Lam Tang Wai (Tang Wai Melodic Mode)"
  },
  {
    "name": "ลำนำ",
    "nameEn": "Melodic Chant / Poetic Canto"
  },
  {
    "name": "ลำเพลิน",
    "nameEn": "Lam Phloen (Lively Isan Folk Dance Song)"
  },
  {
    "name": "ลิลิตพระลอ",
    "nameEn": "Lilit Phra Lo (Northern Romance Epic Poem)"
  },
  {
    "name": "ลูกไม้",
    "nameEn": "Lace Embroidery / Openwork Textile"
  },
  {
    "name": "ล่องใต้",
    "nameEn": "Voyaging to the South"
  },
  {
    "name": "ล้านนา",
    "nameEn": "Lanna Kingdom (Northern Heritage)"
  },
  {
    "name": "วสันตฤดู",
    "nameEn": "Vasantarutu (Spring / Rainy Season of Renewal)"
  },
  {
    "name": "วังหน้า",
    "nameEn": "Wang Na (The Front Palace)"
  },
  {
    "name": "วัฒนธรรมการกิน",
    "nameEn": "Culinary Culture & Dining Traditions"
  },
  {
    "name": "วันทอง",
    "nameEn": "Wan Thong (Heroine of Khun Chang Khun Phaen)"
  },
  {
    "name": "วันวาน",
    "nameEn": "Yesteryear / Historic Times"
  },
  {
    "name": "วาจา",
    "nameEn": "Eloquent Speech / Spoken Word"
  },
  {
    "name": "วาดภาพ",
    "nameEn": "Painting / Depicting in Art"
  },
  {
    "name": "วาดรูป",
    "nameEn": "Drawing / Sketching Portraits"
  },
  {
    "name": "วานร",
    "nameEn": "Vanara (Mythological Monkey Warrior)"
  },
  {
    "name": "วานรินทร์",
    "nameEn": "Vanarindra (King of Monkeys)"
  },
  {
    "name": "วิชนี",
    "nameEn": "Wichani (Royal Ceremonial Fan)"
  },
  {
    "name": "วิดน้ำ",
    "nameEn": "Bailing Water from Paddy / Boat"
  },
  {
    "name": "วิถีชีวิต",
    "nameEn": "Traditional Way of Life"
  },
  {
    "name": "วิรุญจำบัง",
    "nameEn": "Wirun Chambang (Invisibility Demon General)"
  },
  {
    "name": "วิรุญมุข",
    "nameEn": "Wirun Muk (Demon Prince / Son of Wirun Chambang)"
  },
  {
    "name": "วิรุณจำบัง",
    "nameEn": "Wirun Chambang (Variant Spelling)"
  },
  {
    "name": "ศรนาคบาศ",
    "nameEn": "Nagapasa Arrow (Serpent Coil Arrow)"
  },
  {
    "name": "ศรพรหมาสตร์",
    "nameEn": "Brahmastra Arrow (Invincible Divine Arrow)"
  },
  {
    "name": "ศรพาลจันทร์",
    "nameEn": "Phanchan Arrow (Serrated Crescent Arrow)"
  },
  {
    "name": "ศิลปหัตถกรรม",
    "nameEn": "Handicrafts & Artisanal Crafts"
  },
  {
    "name": "ศิลปะป้องกันตัว",
    "nameEn": "Martial Arts & Combat Systems"
  },
  {
    "name": "ศิลปินแห่งชาติ",
    "nameEn": "National Artist of Thailand"
  },
  {
    "name": "ศีรษะ",
    "nameEn": "Head / Crown Headdress (Chada)"
  },
  {
    "name": "ศุภลักษณ์",
    "nameEn": "Suphalak (Princess Usha's Painter Attendant)"
  },
  {
    "name": "ศูรปนขา",
    "nameEn": "Shurpanakha (Demoness Sister of Ravana)"
  },
  {
    "name": "สกลนคร",
    "nameEn": "Sakon Nakhon Province"
  },
  {
    "name": "สงคราม",
    "nameEn": "War / Epic Conflict"
  },
  {
    "name": "สมทบ",
    "nameEn": "Reinforcing the Troops"
  },
  {
    "name": "สมมุติเทพ",
    "nameEn": "Devaraja (Embodied Divine King)"
  },
  {
    "name": "สมรภูมิ",
    "nameEn": "Battlefield / Martial Arena"
  },
  {
    "name": "สมัยทวารวดี",
    "nameEn": "Dvaravati Period (6th-11th Century)"
  },
  {
    "name": "สมัยลพบุรี",
    "nameEn": "Lopburi Period (11th-13th Century)"
  },
  {
    "name": "สมัยศรีวิชัย",
    "nameEn": "Srivijaya Maritime Period (8th-13th Century)"
  },
  {
    "name": "สมัยสุโขทัย",
    "nameEn": "Sukhothai Period (13th-15th Century)"
  },
  {
    "name": "สระอโนดาต",
    "nameEn": "Lake Anodat (Sacred Himalayan Anavatapta Lake)"
  },
  {
    "name": "สวามิภักดิ์",
    "nameEn": "Fealty / Allegiance"
  },
  {
    "name": "สวามี",
    "nameEn": "Husband / Consort"
  },
  {
    "name": "สอดแทรก",
    "nameEn": "Interweaving / Choreographic Insertion"
  },
  {
    "name": "สะล้อ",
    "nameEn": "Salaw (Northern Two-Stringed Bowed Lute)"
  },
  {
    "name": "สะเดาะ",
    "nameEn": "Unlocking Bad Karma"
  },
  {
    "name": "สะเดาะเคราะห์",
    "nameEn": "Averting Misfortune Ritual"
  },
  {
    "name": "สังข์ทอง",
    "nameEn": "Sang Thong (The Golden Conch Play)"
  },
  {
    "name": "สังหาร",
    "nameEn": "Slaying / Defeating Foes"
  },
  {
    "name": "สัตว์น้ำ",
    "nameEn": "Aquatic Fauna / Freshwater Fish"
  },
  {
    "name": "สัทธาสูร",
    "nameEn": "Satthasur (Devout Demon King of Astasur)"
  },
  {
    "name": "สากตำข้าว",
    "nameEn": "Rice Pounding Pestle (Saak)"
  },
  {
    "name": "สากล",
    "nameEn": "Universal / International Standard"
  },
  {
    "name": "สายน้ำ",
    "nameEn": "River Stream / Watercourse"
  },
  {
    "name": "สายสืบ",
    "nameEn": "Scout / Intelligence Spy"
  },
  {
    "name": "สำมนักขา",
    "nameEn": "Sammanakkha (Thai Vernacular for Shurpanakha)"
  },
  {
    "name": "สำเนียง",
    "nameEn": "Musical Accent / Regional Inflection"
  },
  {
    "name": "สำเภา",
    "nameEn": "Junk Ship / Maritime Merchant Vessel"
  },
  {
    "name": "สิบแปดมงกุฎ",
    "nameEn": "Eighteen Crowned Monkey Generals"
  },
  {
    "name": "สิ่งศักดิ์สิทธิ์",
    "nameEn": "Sacred Holy Objects & Deities"
  },
  {
    "name": "สิ้นชีพ",
    "nameEn": "Demise / Passing Away"
  },
  {
    "name": "สิ้นชีวิต",
    "nameEn": "Loss of Life / Heroic Death"
  },
  {
    "name": "สีทอง",
    "nameEn": "Golden Radiant Hue"
  },
  {
    "name": "สีน้ำเงิน",
    "nameEn": "Deep Blue Indigo Hue"
  },
  {
    "name": "สี่ภาค",
    "nameEn": "The Four Geographic Regions of Thailand"
  },
  {
    "name": "สุขสยาม",
    "nameEn": "Suk Siam (Joyous Cultural Heritage Pavilion)"
  },
  {
    "name": "สุครีพ",
    "nameEn": "Sugriva (Monkey King / Brother of Vali)"
  },
  {
    "name": "สุทธาวาส",
    "nameEn": "Suddhavasa (Pure Abodes of Brahma Realm)"
  },
  {
    "name": "สุพรรณมัจฉา",
    "nameEn": "Suphannamatcha (Golden Mermaid Princess)"
  },
  {
    "name": "สุรินทร์",
    "nameEn": "Surin Province"
  },
  {
    "name": "หญิงสาว",
    "nameEn": "Young Maiden / Folk Dancer"
  },
  {
    "name": "หนังใหญ่",
    "nameEn": "Nang Yai (Grand Shadow Puppet Theatre)"
  },
  {
    "name": "หนุมาน",
    "nameEn": "Hanuman (White Monkey Warrior General)"
  },
  {
    "name": "หน่อไม้",
    "nameEn": "Bamboo Shoots"
  },
  {
    "name": "หน้าบัน",
    "nameEn": "Pediment / Gable Artwork"
  },
  {
    "name": "หมดแรง",
    "nameEn": "Exhaustion from Battle / Physical Labor"
  },
  {
    "name": "หมากกั๊บแก๊บ",
    "nameEn": "Mak Gup-Gap (Wooden Folk Castanets)"
  },
  {
    "name": "หยอกล้อ",
    "nameEn": "Playful Teasing / Amorous Banter"
  },
  {
    "name": "หลบหนี",
    "nameEn": "Fleeing / Eluding Pursuit"
  },
  {
    "name": "หลักราชการ",
    "nameEn": "Principles of Royal Civil Governance"
  },
  {
    "name": "หล่อสำริด",
    "nameEn": "Bronze Casting Craft"
  },
  {
    "name": "หอกโมกขศักดิ์",
    "nameEn": "Mokkhasak Spear (Divine Celestial Lance)"
  },
  {
    "name": "หางนกยูง",
    "nameEn": "Peacock Feather Whisks (Praleng Prop)"
  },
  {
    "name": "หายตัว",
    "nameEn": "Invisibility / Concealment Arts"
  },
  {
    "name": "องคต",
    "nameEn": "Ongkhot (Angada / Monkey Prince Emissary)"
  },
  {
    "name": "องค์ปะตาระกาหลา",
    "nameEn": "Batara Kala (Supreme Ancestral God in Panji Lore)"
  },
  {
    "name": "อนุชา",
    "nameEn": "Younger Brother / Prince Royal Brother"
  },
  {
    "name": "อยุธยา",
    "nameEn": "Ayutthaya Kingdom"
  },
  {
    "name": "อวตาร",
    "nameEn": "Avatar (Divine Incarnation / Descent)"
  },
  {
    "name": "อสูร",
    "nameEn": "Asura (Titan / Mythological Demon)"
  },
  {
    "name": "ออกรบ",
    "nameEn": "Marching Forth to Battle"
  },
  {
    "name": "ออกศึก",
    "nameEn": "Entering the Campaign"
  },
  {
    "name": "ออกอุบาย",
    "nameEn": "Devising a Stratagem"
  },
  {
    "name": "ออกเดินทาง",
    "nameEn": "Setting Forth on a Journey"
  },
  {
    "name": "อัญมณี",
    "nameEn": "Precious Gemstones / Nine Gems (Noppharat)"
  },
  {
    "name": "อาจารย์",
    "nameEn": "Professor / Venerated Teacher"
  },
  {
    "name": "อาณาประชาราษฎร์",
    "nameEn": "Subjects of the Realm / The People"
  },
  {
    "name": "อาวุธ",
    "nameEn": "Prop Weaponry / Arms"
  },
  {
    "name": "อาสา",
    "nameEn": "Volunteering Devotion / Loyal Duty"
  },
  {
    "name": "อาหาร",
    "nameEn": "Traditional Cuisine / Food"
  },
  {
    "name": "อิทธิฤทธิ์",
    "nameEn": "Miraculous Spiritual Might"
  },
  {
    "name": "อินทรชิต",
    "nameEn": "Indrajit (Conqueror of Indra / Eldest Son of Ravana)"
  },
  {
    "name": "อินทราภิเษก",
    "nameEn": "Indra-phisek Royal Consecration Ceremony"
  },
  {
    "name": "อินเดีย",
    "nameEn": "India"
  },
  {
    "name": "อินโดนีเซีย",
    "nameEn": "Indonesia"
  },
  {
    "name": "อิเหนา",
    "nameEn": "Inao (Panji Hero of Javanese-Thai Romance)"
  },
  {
    "name": "อีสาน",
    "nameEn": "Isan"
  },
  {
    "name": "อุณรุท",
    "nameEn": "Unarut (Aniruddha / Grandson of Krishna)"
  },
  {
    "name": "อุปราช",
    "nameEn": "Uparaja (Viceroy / Deputy King)"
  },
  {
    "name": "อุษา",
    "nameEn": "Usha (Princess Usha)"
  },
  {
    "name": "ฮินดู",
    "nameEn": "Hindu Traditions & Cosmology"
  },
  {
    "name": "เกราะลอ",
    "nameEn": "Kro Law (Bamboo Slit Bell / Percussion)"
  },
  {
    "name": "เกษตรกรรม",
    "nameEn": "Agrarian Husbandry"
  },
  {
    "name": "เกียรติศักดิ์ไทย",
    "nameEn": "Kiatisak Thai (Honor of the Thai Nation Anthem)"
  },
  {
    "name": "เขาสัตภัณฑ์",
    "nameEn": "Seven Concentric Mountain Ranges"
  },
  {
    "name": "เขาอังกาศ",
    "nameEn": "Mount Angkat (Sacred Demon Mountain)"
  },
  {
    "name": "เขาไกรลาส",
    "nameEn": "Mount Kailash (Abode of Lord Shiva)"
  },
  {
    "name": "เขาไกลลาศ",
    "nameEn": "Mount Kailash (Variant Spelling)"
  },
  {
    "name": "เขี้ยวแก้ว",
    "nameEn": "Sacred Tooth Relic of the Buddha"
  },
  {
    "name": "เข้าเฝ้า",
    "nameEn": "Audience with Royalty / Sovereign"
  },
  {
    "name": "เครื่องดนตรีตะวันตก",
    "nameEn": "Western Musical Instruments"
  },
  {
    "name": "เครื่องดนตรีพื้นบ้าน",
    "nameEn": "Traditional Folk Musical Instruments"
  },
  {
    "name": "เครื่องดนตรีพื้นเมือง",
    "nameEn": "Regional Folk Instruments"
  },
  {
    "name": "เครื่องดนตรีสากล",
    "nameEn": "International Musical Instruments"
  },
  {
    "name": "เครื่องประกอบจังหวะ",
    "nameEn": "Rhythmic Percussion Instruments"
  },
  {
    "name": "เครื่องประดับ",
    "nameEn": "Royal Jewelry & Body Ornaments"
  },
  {
    "name": "เครื่องแบบ",
    "nameEn": "Ceremonial Uniform / Ensemble"
  },
  {
    "name": "เคลื่อนไหว",
    "nameEn": "Movement & Physical Expression"
  },
  {
    "name": "เจ้าดารารัศมี",
    "nameEn": "Princess Dara Rasmi of Chiang Mai"
  },
  {
    "name": "เจ้าที่เจ้าทาง",
    "nameEn": "Guardian Earth Spirit of the Place"
  },
  {
    "name": "เจ้าพระยา",
    "nameEn": "Chao Phraya (Highest Rank of Nobility)"
  },
  {
    "name": "เจ้าหญิง",
    "nameEn": "Princess"
  },
  {
    "name": "เจ้าเงาะ",
    "nameEn": "Chao Ngo (The Disguised Conch Prince)"
  },
  {
    "name": "เจ้าเซ็น",
    "nameEn": "Chao Sen (Persian / Shiite Heritage Group)"
  },
  {
    "name": "เชษฐา",
    "nameEn": "Elder Brother / King Royal Brother"
  },
  {
    "name": "เชิงบันได",
    "nameEn": "Balustrade / Sanctuary Steps"
  },
  {
    "name": "เชิงมวย",
    "nameEn": "Boxing Stance / Martial Footwork"
  },
  {
    "name": "เชียงใหม่",
    "nameEn": "Chiang Mai Province"
  },
  {
    "name": "เดินทาง",
    "nameEn": "Travel / Journey"
  },
  {
    "name": "เดินอากาศ",
    "nameEn": "Aerial Striding (Acrobatic God/Demon Movement)"
  },
  {
    "name": "เต้นสาก",
    "nameEn": "Pestle Dance (Bamboo Clapping Dance)"
  },
  {
    "name": "เถิดเทิง",
    "nameEn": "Thoet Thoeng (Long Drum Folk Festival Dance)"
  },
  {
    "name": "เทพธิดา",
    "nameEn": "Devi (Goddess / Celestial Maiden)"
  },
  {
    "name": "เทพนิยาย",
    "nameEn": "Mythological Folklore / Fairy Tale"
  },
  {
    "name": "เทพบุตร",
    "nameEn": "Devaputra (Male Celestial Deity / Angel)"
  },
  {
    "name": "เทพเจ้า",
    "nameEn": "Deities / Divine Celestial Pantheon"
  },
  {
    "name": "เทวดา",
    "nameEn": "Deva (Celestial Deity)"
  },
  {
    "name": "เทือกเขาภูพาน",
    "nameEn": "Phu Phan Mountain Range"
  },
  {
    "name": "เบญกาย",
    "nameEn": "Benyakai (Demon Maiden / Niece of Ravana)"
  },
  {
    "name": "เบิกโรง",
    "nameEn": "Overture / Prologue Dance (Boek Rong)"
  },
  {
    "name": "เพทาย",
    "nameEn": "Zircon (Hyacinth Gem)"
  },
  {
    "name": "เพลงกลม",
    "nameEn": "Phleng Klom (Sacred Lullaby & Deva Movement Suite)"
  },
  {
    "name": "เพลงคืนเดือนหงาย",
    "nameEn": "Phleng Khuen Duean Ngai (Moonlit Night Song)"
  },
  {
    "name": "เพลงงามแสงเดือน",
    "nameEn": "Phleng Ngam Saeng Duean (Beauty of Moonlight Song)"
  },
  {
    "name": "เพลงฉิ่ง",
    "nameEn": "Phleng Ching (Cymbal Rhythm Dance Song)"
  },
  {
    "name": "เพลงชาวไทย",
    "nameEn": "Phleng Chao Thai (Thai Compatriots Patriotic Song)"
  },
  {
    "name": "เพลงชำนาญ",
    "nameEn": "Phleng Chamnan (Virtuoso Classical Song)"
  },
  {
    "name": "เพลงดวงจันทร์ขวัญฟ้า",
    "nameEn": "Phleng Duang Chan Khwan Fa (Beloved Moon Song)"
  },
  {
    "name": "เพลงดวงจันทร์วันเพ็ญ",
    "nameEn": "Phleng Duang Chan Wan Phen (Full Moon Song)"
  },
  {
    "name": "เพลงดอกไม้ของชาติ",
    "nameEn": "Phleng Dok Mai Khong Chat (Flowers of the Nation)"
  },
  {
    "name": "เพลงบูชานักรบ",
    "nameEn": "Phleng Bucha Nak Rop (Warrior Tribute Song)"
  },
  {
    "name": "เพลงฝรั่งรำเท้า",
    "nameEn": "Phleng Farang Ram Thao (Western Stepping Dance Song)"
  },
  {
    "name": "เพลงฟ้อนดวงดอกไม้",
    "nameEn": "Phleng Fon Duang Dok Mai (Flower Dance Song)"
  },
  {
    "name": "เพลงมอญดูดาว",
    "nameEn": "Phleng Mon Du Dao (Mon Stargazing Melody)"
  },
  {
    "name": "เพลงยอดชายใจหาญ",
    "nameEn": "Phleng Yot Chai Chai Han (Valiant Men Song)"
  },
  {
    "name": "เพลงรำซิมารำ",
    "nameEn": "Phleng Ram Si Ma Ram (Come Join the Dance Song)"
  },
  {
    "name": "เพลงลาวคำหอม",
    "nameEn": "Phleng Lao Kham Hom (Sweet Words Lao Melody)"
  },
  {
    "name": "เพลงสากล",
    "nameEn": "Western / International Music"
  },
  {
    "name": "เพลงสำเนียงลาว",
    "nameEn": "Lao-Accented Musical Mode"
  },
  {
    "name": "เพลงหญิงไทยใจงาม",
    "nameEn": "Phleng Ying Thai Chai Ngam (Graceful Thai Women Song)"
  },
  {
    "name": "เพลงหน้าพาทย์",
    "nameEn": "Phleng Na Phat (Sacred Ritual Dramatic Music)"
  },
  {
    "name": "เพลงอัตราจังหวะสองชั้น",
    "nameEn": "Medium-Tempo Two-Tier Rhythm Song"
  },
  {
    "name": "เพลงเร็ว",
    "nameEn": "Phleng Rew (Fast-Tempo Classical Dance Tune)"
  },
  {
    "name": "เพลงไทย",
    "nameEn": "Traditional Thai Classical Song"
  },
  {
    "name": "เมขลา",
    "nameEn": "Mani Mekhala (Goddess of Lightning and the Seas)"
  },
  {
    "name": "เมืองขีดขิน",
    "nameEn": "Kishkindha City"
  },
  {
    "name": "เมืองชมพู",
    "nameEn": "Champu (Kingdom of Bear / Monkey Elders)"
  },
  {
    "name": "เล่นน้ำ",
    "nameEn": "Water Frolicking / Songkran Splash"
  },
  {
    "name": "เวที",
    "nameEn": "Stage / Theatrical Platform"
  },
  {
    "name": "เสนียดจัญไร",
    "nameEn": "Inauspicious Pollution / Calamity"
  },
  {
    "name": "เสียงดนตรี",
    "nameEn": "Musical Sounds & Harmonies"
  },
  {
    "name": "แกล้งทำ",
    "nameEn": "Dramatic Feigning / Theatrical Deception"
  },
  {
    "name": "แก้แค้น",
    "nameEn": "Vengeance / Retribution"
  },
  {
    "name": "แควน้อย",
    "nameEn": "Khwae Noi River"
  },
  {
    "name": "แตกทัพ",
    "nameEn": "Rout / Dispersing the Enemy Force"
  },
  {
    "name": "แต่งกายยืนเครื่องพระ",
    "nameEn": "Royal Hero Courtly Costume (Yuen Khrueang Phra)"
  },
  {
    "name": "แต่งตัว",
    "nameEn": "Costuming / Dressing Up"
  },
  {
    "name": "แปลงกาย",
    "nameEn": "Metamorphosis / Shape-Shifting"
  },
  {
    "name": "แปลงตัว",
    "nameEn": "Disguise / Role Transformation"
  },
  {
    "name": "แผ่อิทธิพล",
    "nameEn": "Expanding Imperial Influence"
  },
  {
    "name": "แมนสรวง",
    "nameEn": "Muen Suang (Mythical Heavenly City of Phra Lo)"
  },
  {
    "name": "แม่ท่า",
    "nameEn": "Fundamental Choreographic Postures (Mae Tha)"
  },
  {
    "name": "แม่น้ำ",
    "nameEn": "River"
  },
  {
    "name": "แม่น้ำโขง",
    "nameEn": "Mekong River"
  },
  {
    "name": "แม่บท",
    "nameEn": "Master Repertoire (Mae Bot Basic Vocabulary)"
  },
  {
    "name": "แม่ฮ่องสอน",
    "nameEn": "Mae Hong Son Province"
  },
  {
    "name": "แม่ไม้มวย",
    "nameEn": "Mae Mai Muay (Core Master Techniques of Muay Thai)"
  },
  {
    "name": "แว่นแก้วสุรกานต์",
    "nameEn": "Surakant Sun Glass (Solar Fire Reflector)"
  },
  {
    "name": "แสงจันทร์",
    "nameEn": "Moonlight / Lunar Radiance"
  },
  {
    "name": "แสงอาทิตย์",
    "nameEn": "Sunlight / Solar Radiance"
  },
  {
    "name": "แหลมมลายู",
    "nameEn": "Malay Peninsula"
  },
  {
    "name": "แหล่งน้ำ",
    "nameEn": "Water Body / Aquatic Habitat"
  },
  {
    "name": "โกเมน",
    "nameEn": "Garnet (Deep Red Gem)"
  },
  {
    "name": "โคมเวียน",
    "nameEn": "Revolving Ceremonial Lantern"
  },
  {
    "name": "โบราณวัตถุ",
    "nameEn": "Antiquities / Archaeological Artifacts"
  },
  {
    "name": "โบราณสถาน",
    "nameEn": "Ancient Historical Monument"
  },
  {
    "name": "โปงลาง",
    "nameEn": "Pong Lang (Isan Wooden Log Xylophone)"
  },
  {
    "name": "โปรตุเกส",
    "nameEn": "Portugal / Portuguese Contact"
  },
  {
    "name": "โรงละครแห่งชาติ",
    "nameEn": "National Theatre of Thailand"
  },
  {
    "name": "โอดิสสี",
    "nameEn": "Odissi Classical Indian Dance"
  },
  {
    "name": "โอรส",
    "nameEn": "Royal Prince / Son"
  },
  {
    "name": "ใบชา",
    "nameEn": "Tea Leaves (Bai Cha)"
  },
  {
    "name": "ให้ร้าย",
    "nameEn": "Slander / False Accusation"
  },
  {
    "name": "ได้ยิน",
    "nameEn": "Hearing the Call / Perceiving Sounds"
  },
  {
    "name": "ไตรรงค์",
    "nameEn": "Trairanga (The Thai Tricolor Flag)"
  },
  {
    "name": "ไทภูเขา",
    "nameEn": "Tai Mountain Communities"
  },
  {
    "name": "ไทยจักรพรรดิ์",
    "nameEn": "Thai Chakkraphat (Imperial Royal Costume Style)"
  },
  {
    "name": "ไทยจักรี",
    "nameEn": "Thai Chakkri (Classic Royal National Dress)"
  },
  {
    "name": "ไทยจิตรลดา",
    "nameEn": "Thai Chitralada (Daytime Royal National Dress)"
  },
  {
    "name": "ไทยจีน",
    "nameEn": "Thai-Chinese Community"
  },
  {
    "name": "ไทยดุสิต",
    "nameEn": "Thai Dusit (Royal Court Dress Style)"
  },
  {
    "name": "ไทยทรงดำ",
    "nameEn": "Thai Song Dam (Lao Song Ethnic Group)"
  },
  {
    "name": "ไทยบรมพิมาน",
    "nameEn": "Thai Boromphiman (Formal Evening Royal Dress)"
  },
  {
    "name": "ไทยรามัญ",
    "nameEn": "Thai-Mon (Raman Heritage Group)"
  },
  {
    "name": "ไทยศิวาลัย",
    "nameEn": "Thai Siwalai (Regal Court Costume Style)"
  },
  {
    "name": "ไทยอมรินทร์",
    "nameEn": "Thai Amarin (Royal Palace Musical Suite)"
  },
  {
    "name": "ไทยเรือนต้น",
    "nameEn": "Thai Ruan Ton (Casual Traditional Costume)"
  },
  {
    "name": "ไพฑูรย์",
    "nameEn": "Chrysoberyl Cat's Eye Gem"
  },
  {
    "name": "ไพร่พล",
    "nameEn": "Rank-and-File Soldiers / Forces"
  },
  {
    "name": "ไฟไหม้",
    "nameEn": "Trial by Fire / Conflagration"
  },
  {
    "name": "ไม้ยาว",
    "nameEn": "Long Bamboo Pole (Percussion Prop)"
  },
  {
    "name": "ไม้สั้น",
    "nameEn": "Short Wooden Truncheon (Phlong Mai San)"
  },
  {
    "name": "ไส้กะลา",
    "nameEn": "Coconut Shell Core / Lamp Wick"
  },
  {
    "name": "ไหว้ครู",
    "nameEn": "Wai Khru Reverence to Gurus"
  }
];

/**
 * Seeds academic bilingual metadata (English titles, descriptions, categories,
 * keywords, and taxonomy nodes) derived from the canonical WIPHITSILPA reference
 * (Bunditpatanasilpa Institute / Ministry of Culture).
 */
export async function seedCatalogueBilingual(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (manager) => {
    // 1. Contexts
    for (const ctx of CONTEXT_TRANSLATIONS) {
      await manager.query(
        `UPDATE contexts SET name_en = $1, description_en = $2 WHERE name = $3`,
        [ctx.nameEn, ctx.descriptionEn, ctx.name],
      );
    }

    // 2. Taxonomy Nodes
    for (const tax of TAXONOMY_TRANSLATIONS) {
      await manager.query(
        `UPDATE taxonomy_nodes SET name_en = $1 WHERE id = $2`,
        [tax.nameEn, tax.id],
      );
    }

    // 3. Keywords
    for (const kw of KEYWORD_TRANSLATIONS) {
      await manager.query(
        `UPDATE keywords SET name_en = $1 WHERE name = $2`,
        [kw.nameEn, kw.name],
      );
    }

    // 4. Items
    for (const item of ITEM_TRANSLATIONS) {
      await manager.query(
        `UPDATE items
         SET name_en = $1, description_en = $2, category_group_en = $3, performance_type_en = $4
         WHERE name = $5`,
        [item.nameEn, item.descriptionEn, item.categoryGroupEn, item.performanceTypeEn, item.name],
      );
    }
  });
}
